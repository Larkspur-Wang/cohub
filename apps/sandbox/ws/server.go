package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/protocol"
	"github.com/cohub/apps/sandbox/report"
	"github.com/cohub/apps/sandbox/rpc"
)

type prepareState interface {
	Get() (status string, errMsg string)
	GetSetup() *protocol.SandboxSetupInfo
}

type Server struct {
	cfg            env.Config
	dispatcher     *rpc.Dispatcher
	processManager *process.Manager
	reporter       *report.Client
	prepareState   prepareState
	hostname       string
	logger         *slog.Logger
	startedAt      time.Time

	mu                      sync.RWMutex
	sessionsByID            map[string]*connectionSession
	sessionIDsByIdentity    map[string]map[string]struct{}
	cleanupTimersByIdentity map[string]*time.Timer

	healthMu                 sync.Mutex
	cachedZombieProcessCount int
	cachedZombieObservedAt   time.Time
	lastSelfHealObservedAt   time.Time
	zombieSelfHealTicks      int
	mountSelfHealTriggered   bool
	recovering               bool
}

type connectionSession struct {
	id          string
	spaceID     string
	identity    string
	attached    bool
	ctx         context.Context
	cancel      context.CancelFunc
	conn        *websocket.Conn
	sendCh      chan []byte
	connectedAt time.Time
}

const identityProcessCleanupGrace = 30 * time.Second

func NewServer(
	cfg env.Config,
	dispatcher *rpc.Dispatcher,
	processManager *process.Manager,
	reporter *report.Client,
	prepareState prepareState,
	hostname string,
	logger *slog.Logger,
) *Server {
	s := &Server{
		cfg:                     cfg,
		dispatcher:              dispatcher,
		processManager:          processManager,
		reporter:                reporter,
		prepareState:            prepareState,
		hostname:                hostname,
		logger:                  logger,
		startedAt:               time.Now(),
		sessionsByID:            make(map[string]*connectionSession),
		sessionIDsByIdentity:    make(map[string]map[string]struct{}),
		cleanupTimersByIdentity: make(map[string]*time.Timer),
	}
	dispatcher.SetRouter(s)
	return s
}

func (s *Server) Run() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/sandbox", s.handleSandbox)
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/readyz", s.handleReadyz)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("Not found"))
	})

	addr := fmt.Sprintf("%s:%d", env.DefaultSandboxWSHost, env.DefaultSandboxWSPort)
	s.logger.Info("sandbox ws server listening", slog.String("addr", addr))
	return http.ListenAndServe(addr, mux)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (s *Server) handleReadyz(w http.ResponseWriter, _ *http.Request) {
	s.healthMu.Lock()
	recovering := s.recovering
	s.healthMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if recovering {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"ok":false,"status":"recovering"}`))
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

const wsReadLimit = 50 * 1024 * 1024 // 50MB per websocket message

func (s *Server) broadcastAttached(message interface{}, warnMessage string) {
	s.mu.RLock()
	targets := make([]*connectionSession, 0, len(s.sessionsByID))
	for _, session := range s.sessionsByID {
		if session.attached {
			targets = append(targets, session)
		}
	}
	s.mu.RUnlock()

	for _, session := range targets {
		if err := s.sendToConnection(session, message); err != nil {
			s.logger.Warn(warnMessage, slog.String("connectionId", session.id), slog.String("identity", session.identity), slog.String("error", err.Error()))
		}
	}
}

func (s *Server) BroadcastFSChanged(payload protocol.FSChangedPayload) {
	message := protocol.FSChanged{
		BaseMessage: protocol.BaseMessage{
			Version:   protocol.Version,
			Type:      "fs.changed",
			SpaceID:   s.cfg.SpaceID,
			SandboxID: s.hostname,
			Timestamp: time.Now().UnixMilli(),
		},
		Payload: payload,
	}

	s.broadcastAttached(message, "failed to enqueue fs.changed")
}

func (s *Server) BroadcastPortsChanged(payload protocol.PortsChangedPayload) {
	message := protocol.PortsChanged{
		BaseMessage: protocol.BaseMessage{
			Version:   protocol.Version,
			Type:      "ports.changed",
			SpaceID:   s.cfg.SpaceID,
			SandboxID: s.hostname,
			Timestamp: time.Now().UnixMilli(),
		},
		Payload: payload,
	}

	s.broadcastAttached(message, "failed to enqueue ports.changed")
}

func (s *Server) handleSandbox(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		s.logger.Error("failed to accept websocket", slog.String("error", err.Error()))
		return
	}
	conn.SetReadLimit(wsReadLimit)

	ctx, cancel := context.WithCancel(r.Context())
	session := &connectionSession{
		id:          uuid.NewString(),
		spaceID:     s.cfg.SpaceID,
		ctx:         ctx,
		cancel:      cancel,
		conn:        conn,
		sendCh:      make(chan []byte, 256),
		connectedAt: time.Now(),
	}
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "closing")
	defer s.removeSession(session)

	s.addSession(session)
	s.logger.Info("agent connected", slog.String("remote", r.RemoteAddr), slog.String("connectionId", session.id))
	go s.writeLoop(session)
	go s.heartbeatLoop(session)

	if err := s.sendHeartbeat(session, true); err != nil {
		s.logger.Error("failed to send initial sandbox.heartbeat", slog.String("error", err.Error()))
		return
	}

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			s.logger.Info("agent connection closed", slog.String("connectionId", session.id), slog.String("identity", session.identity), slog.String("error", err.Error()))
			return
		}

		var envelope protocol.IncomingEnvelope
		if err := json.Unmarshal(data, &envelope); err != nil {
			s.logger.Warn("failed to parse incoming envelope", slog.String("connectionId", session.id), slog.String("error", err.Error()))
			continue
		}

		switch envelope.Type {
		case "session.attach":
			var attach protocol.SessionAttach
			if err := json.Unmarshal(data, &attach); err != nil {
				s.logger.Warn("failed to parse session.attach", slog.String("connectionId", session.id), slog.String("error", err.Error()))
				continue
			}
			s.handleSessionAttach(session, attach)
		case "rpc.request":
			if !session.attached || session.identity == "" {
				s.logger.Warn("rpc.request before attach", slog.String("connectionId", session.id))
				continue
			}
			var request protocol.RPCRequest
			if err := json.Unmarshal(data, &request); err != nil {
				s.logger.Warn("failed to parse rpc.request", slog.String("connectionId", session.id), slog.String("error", err.Error()))
				continue
			}
			s.logger.Debug("rpc:request received", slog.String("connectionId", session.id), slog.String("identity", session.identity), slog.String("method", request.Method), slog.String("requestId", request.RequestID))
			go s.handleRPCRequest(session, request)
		default:
			s.logger.Warn("unknown incoming message type", slog.String("connectionId", session.id), slog.String("type", envelope.Type))
		}
	}
}

func (s *Server) addSession(session *connectionSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessionsByID[session.id] = session
}

func (s *Server) removeSession(session *connectionSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessionsByID, session.id)
	if session.identity == "" {
		return
	}
	ids := s.sessionIDsByIdentity[session.identity]
	if ids == nil {
		return
	}
	delete(ids, session.id)
	if len(ids) > 0 {
		return
	}
	delete(s.sessionIDsByIdentity, session.identity)
	if timer := s.cleanupTimersByIdentity[session.identity]; timer != nil {
		timer.Stop()
	}
	identity := session.identity
	s.cleanupTimersByIdentity[identity] = time.AfterFunc(identityProcessCleanupGrace, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		ids := s.sessionIDsByIdentity[identity]
		if len(ids) > 0 {
			delete(s.cleanupTimersByIdentity, identity)
			return
		}
		s.logger.Info("cleaning up processes for disconnected identity", slog.String("identity", identity), slog.Duration("grace", identityProcessCleanupGrace))
		s.processManager.AbortByIdentity(identity)
		delete(s.cleanupTimersByIdentity, identity)
	})
}

func (s *Server) attachIdentity(session *connectionSession, identity string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if session.identity != "" {
		if ids := s.sessionIDsByIdentity[session.identity]; ids != nil {
			delete(ids, session.id)
			if len(ids) == 0 {
				delete(s.sessionIDsByIdentity, session.identity)
			}
		}
	}
	if timer := s.cleanupTimersByIdentity[identity]; timer != nil {
		timer.Stop()
		delete(s.cleanupTimersByIdentity, identity)
	}
	session.identity = identity
	session.attached = true
	ids := s.sessionIDsByIdentity[identity]
	if ids == nil {
		ids = make(map[string]struct{})
		s.sessionIDsByIdentity[identity] = ids
	}
	ids[session.id] = struct{}{}
}

func (s *Server) SendToIdentity(identity string, v interface{}) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}

	s.mu.RLock()
	ids := s.sessionIDsByIdentity[identity]
	targets := make([]*connectionSession, 0, len(ids))
	for sessionID := range ids {
		if session, ok := s.sessionsByID[sessionID]; ok {
			targets = append(targets, session)
		}
	}
	s.mu.RUnlock()

	for _, session := range targets {
		if err := enqueuePayload(session, payload); err != nil {
			s.logger.Warn("failed to enqueue identity payload", slog.String("identity", identity), slog.String("connectionId", session.id), slog.String("error", err.Error()))
		}
	}
	return nil
}

func (s *Server) handleSessionAttach(session *connectionSession, attach protocol.SessionAttach) {
	identity := attach.Identity
	if identity == "" {
		s.logger.Warn("session.attach missing identity", slog.String("connectionId", session.id))
		return
	}
	s.attachIdentity(session, identity)
	s.logger.Info("session attached", slog.String("connectionId", session.id), slog.String("identity", identity))
	payload := protocol.SessionAttachOK{
		BaseMessage: protocol.BaseMessage{
			Version:   protocol.Version,
			Type:      "session.attach.ok",
			SpaceID:   s.cfg.SpaceID,
			SandboxID: s.hostname,
			Timestamp: time.Now().UnixMilli(),
		},
		RequestID:    attach.RequestID,
		ConnectionID: session.id,
		Identity:     identity,
	}
	if err := s.sendToConnection(session, payload); err != nil {
		s.logger.Warn("failed to send session.attach.ok", slog.String("connectionId", session.id), slog.String("identity", identity), slog.String("error", err.Error()))
	}
}

func (s *Server) writeLoop(session *connectionSession) {
	for {
		select {
		case <-session.ctx.Done():
			return
		case payload := <-session.sendCh:
			if err := session.conn.Write(session.ctx, websocket.MessageText, payload); err != nil {
				s.logger.Warn("failed to write websocket message", slog.String("connectionId", session.id), slog.String("identity", session.identity), slog.String("error", err.Error()))
				session.cancel()
				return
			}
		}
	}
}

func (s *Server) handleRPCRequest(session *connectionSession, request protocol.RPCRequest) {
	accepted, response := s.dispatcher.Handle(request, session.identity)
	if err := s.sendToConnection(session, accepted); err != nil {
		s.logger.Warn("failed to send rpc.accepted", slog.String("connectionId", session.id), slog.String("identity", session.identity), slog.String("requestId", request.RequestID), slog.String("method", request.Method), slog.String("error", err.Error()))
		return
	}
	if response == nil {
		return
	}
	if failed, ok := response.(protocol.RPCFailed); ok {
		s.maybeSelfHealOnStaleMount(request, failed)
	}
	if err := s.SendToIdentity(session.identity, response); err != nil {
		s.logger.Warn("failed to send rpc result to identity", slog.String("identity", session.identity), slog.String("requestId", request.RequestID), slog.String("method", request.Method), slog.String("error", err.Error()))
	}
}

func (s *Server) sendToConnection(session *connectionSession, v interface{}) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return enqueuePayload(session, payload)
}

func (s *Server) sendHeartbeat(session *connectionSession, includeSnapshot bool) error {
	prepareStatus, _ := s.prepareState.Get()
	attachedSessions := s.attachedSessionCount()
	processStats := s.processManager.Stats()
	observedZombieCount, observedAt := s.getZombieProcessCount()
	setupInfo := s.prepareState.GetSetup()
	message := protocol.SandboxHeartbeat{
		BaseMessage: protocol.BaseMessage{
			Version:   protocol.Version,
			Type:      "sandbox.heartbeat",
			SpaceID:   s.cfg.SpaceID,
			SandboxID: s.hostname,
			Timestamp: time.Now().UnixMilli(),
		},
		Status: prepareStatus,
		Metadata: &protocol.SandboxMetadata{
			Hostname:     s.hostname,
			ImageVersion: s.cfg.ImageVersion,
			StartedAt:    s.startedAt.UTC().Format(time.RFC3339),
			Process: &protocol.SandboxProcessStats{
				ActiveProcesses:        processStats.ActiveProcesses,
				StartedTotal:           processStats.StartedTotal,
				CompletedTotal:         processStats.CompletedTotal,
				AbortedTotal:           processStats.AbortedTotal,
				TimedOutTotal:          processStats.TimedOutTotal,
				IdentityCleanupTotal:   processStats.IdentityCleanupTotal,
				ForceKilledTotal:       processStats.ForceKilledTotal,
				TerminateFailuresTotal: processStats.TerminateFailuresTotal,
			},
			Health: &protocol.SandboxHealthStats{
				ZombieProcessCount: observedZombieCount,
				AttachedSessions:   attachedSessions,
			},
			Setup: setupInfo,
		},
	}
	if includeSnapshot {
		message.Capabilities = protocol.SandboxCapabilities{
			FSRead:       true,
			FSWrite:      true,
			FSStat:       true,
			FSLs:         true,
			FSFind:       true,
			FSGrep:       true,
			ProcessStart: true,
			ProcessAbort: true,
		}
		message.Filesystem = &protocol.SandboxFilesystem{
			DefaultCwd: s.cfg.WorkspaceDir,
			Mode:       "host-like",
			Notes: []string{
				"sandbox paths follow host-like semantics; cwd defaults to /workspace",
				"/configs/platform/.agents is mounted read-only for platform skills",
				"/configs/user/.agents is mounted read-only for user skills and setup.sh",
				"if /configs/user/.agents/setup.sh exists, sandbox runs it on startup",
			},
			Roots: []protocol.SandboxFilesystemRoot{
				{Path: s.cfg.WorkspaceDir, Writable: true, Label: "cwd"},
				{Path: s.cfg.PlatformAgentsDir, Writable: false, Label: "platform-skills"},
				{Path: s.cfg.UserAgentsDir, Writable: false, Label: "user-agents"},
				{Path: "/tmp", Writable: true, Label: "tmp"},
			},
		}
	}
	s.maybeSelfHealOnZombies(observedZombieCount, observedAt, attachedSessions, processStats.ActiveProcesses)
	return s.sendToConnection(session, message)
}

func (s *Server) heartbeatLoop(session *connectionSession) {
	ticker := time.NewTicker(time.Duration(env.DefaultHeartbeatSecs) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-session.ctx.Done():
			return
		case <-ticker.C:
			if err := s.sendHeartbeat(session, false); err != nil {
				s.logger.Warn("failed to enqueue heartbeat", slog.String("connectionId", session.id), slog.String("identity", session.identity), slog.String("error", err.Error()))
				return
			}
		}
	}
}

func (s *Server) attachedSessionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	count := 0
	for _, ids := range s.sessionIDsByIdentity {
		count += len(ids)
	}
	return count
}

const zombieScanInterval = 15 * time.Second

func (s *Server) getZombieProcessCount() (count int, observedAt time.Time) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	now := time.Now()
	if !s.cachedZombieObservedAt.IsZero() && now.Sub(s.cachedZombieObservedAt) < zombieScanInterval {
		return s.cachedZombieProcessCount, s.cachedZombieObservedAt
	}
	count = scanZombieProcessCount()
	observedAt = now
	s.cachedZombieProcessCount = count
	s.cachedZombieObservedAt = observedAt
	return count, observedAt
}

func scanZombieProcessCount() int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue
		}
		statusPath := "/proc/" + entry.Name() + "/status"
		data, err := os.ReadFile(statusPath)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "State:") && strings.Contains(line, "Z") {
				count++
				break
			}
		}
	}
	return count
}

func (s *Server) maybeSelfHealOnZombies(zombieCount int, observedAt time.Time, attachedSessions int, activeProcesses int) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	threshold := s.cfg.ZombieSelfHealThreshold
	if threshold <= 0 {
		s.zombieSelfHealTicks = 0
		s.lastSelfHealObservedAt = time.Time{}
		return
	}
	if zombieCount < threshold || attachedSessions > 0 || activeProcesses > 0 {
		s.zombieSelfHealTicks = 0
		s.lastSelfHealObservedAt = time.Time{}
		return
	}
	if !observedAt.After(s.lastSelfHealObservedAt) {
		return
	}
	s.lastSelfHealObservedAt = observedAt
	s.zombieSelfHealTicks++
	if s.zombieSelfHealTicks < s.cfg.ZombieSelfHealConsecutiveTicks {
		return
	}
	s.logger.Warn("sandbox self-heal triggered due to zombie accumulation",
		slog.Int("zombieCount", zombieCount),
		slog.Int("threshold", threshold),
		slog.Int("attachedSessions", attachedSessions),
		slog.Int("activeProcesses", activeProcesses),
		slog.Int("consecutiveTicks", s.zombieSelfHealTicks),
	)
	s.selfTerminate("zombie accumulation")
}

func (s *Server) maybeSelfHealOnStaleMount(request protocol.RPCRequest, failed protocol.RPCFailed) {
	message := strings.ToLower(failed.Error.Message)
	if !strings.Contains(message, "stale file handle") && !strings.Contains(message, "stale nfs file handle") {
		return
	}

	criticalRoots := []string{
		s.cfg.WorkspaceDir,
		s.cfg.PlatformAgentsDir,
		s.cfg.UserAgentsDir,
		"/sessions",
		"/public",
	}
	matchedRoot := ""
	for _, root := range criticalRoots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if strings.Contains(message, strings.ToLower(root)) {
			matchedRoot = root
			break
		}
	}
	if matchedRoot == "" {
		return
	}

	s.healthMu.Lock()
	if s.mountSelfHealTriggered {
		s.healthMu.Unlock()
		return
	}
	s.mountSelfHealTriggered = true
	s.recovering = true
	s.healthMu.Unlock()

	s.logger.Warn("sandbox recovery requested due to stale mount",
		slog.String("method", request.Method),
		slog.String("requestId", request.RequestID),
		slog.String("path", matchedRoot),
		slog.String("error", failed.Error.Message),
	)
	go func() {
		for attempt := 1; attempt <= 3; attempt++ {
			if err := s.reporter.Report(report.Payload{
				Status: "error",
				Meta: map[string]interface{}{
					"errorClass":          "stale_mount",
					"requiresPodRecreate": true,
					"mountPath":           matchedRoot,
					"lastError":           failed.Error.Message,
					"recoverySource":      "sandbox",
				},
			}); err != nil {
				s.logger.Warn("failed to report stale mount recovery request", slog.Int("attempt", attempt), slog.String("error", err.Error()))
				time.Sleep(time.Duration(attempt) * time.Second)
				continue
			}
			return
		}
		s.logger.Warn("stale mount recovery report failed; falling back to self terminate")
		s.selfTerminate("stale mount report failed")
	}()
}

func (s *Server) selfTerminate(reason string) {
	if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
		s.logger.Error("failed to signal sandbox for self-heal shutdown", slog.String("reason", reason), slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func enqueuePayload(session *connectionSession, payload []byte) error {
	select {
	case <-session.ctx.Done():
		return session.ctx.Err()
	case session.sendCh <- payload:
		return nil
	case <-time.After(2 * time.Second):
		return fmt.Errorf("outbound websocket queue is full")
	}
}
