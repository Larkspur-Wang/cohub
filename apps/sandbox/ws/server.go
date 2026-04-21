package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/protocol"
	"github.com/cohub/apps/sandbox/rpc"
)

type prepareState interface {
	Get() (status string, errMsg string)
}

type Server struct {
	cfg            env.Config
	dispatcher     *rpc.Dispatcher
	processManager *process.Manager
	prepareState   prepareState
	hostname       string
	logger         *slog.Logger

	mu     sync.Mutex
	active *connectionSession
}

type connectionSession struct {
	ctx    context.Context
	cancel context.CancelFunc
	conn   *websocket.Conn
	sendCh chan []byte
}

type connSender struct {
	session *connectionSession
}

func (s connSender) SendJSON(v interface{}) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return enqueuePayload(s.session, payload)
}

func NewServer(
	cfg env.Config,
	dispatcher *rpc.Dispatcher,
	processManager *process.Manager,
	prepareState prepareState,
	hostname string,
	logger *slog.Logger,
) *Server {
	return &Server{
		cfg:            cfg,
		dispatcher:     dispatcher,
		processManager: processManager,
		prepareState:   prepareState,
		hostname:       hostname,
		logger:         logger,
	}
}

func (s *Server) Run() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/sandbox", s.handleSandbox)
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("Not found"))
	})

	addr := fmt.Sprintf("%s:%d", env.DefaultSandboxWSHost, env.DefaultSandboxWSPort)
	s.logger.Info("sandbox ws server listening", slog.String("addr", addr))
	return http.ListenAndServe(addr, mux)
}

func (s *Server) handleSandbox(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{})
	if err != nil {
		s.logger.Error("failed to accept websocket", slog.String("error", err.Error()))
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	session := &connectionSession{
		ctx:    ctx,
		cancel: cancel,
		conn:   conn,
		sendCh: make(chan []byte, 256),
	}
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "closing")

	s.replaceActiveSession(session)
	defer s.clearActiveSession(session)
	defer s.processManager.AbortAll()

	s.logger.Info("agent connected", slog.String("remote", r.RemoteAddr))
	go s.writeLoop(session)
	go s.heartbeatLoop(session)

	if err := s.sendHello(session); err != nil {
		s.logger.Error("failed to send sandbox.hello", slog.String("error", err.Error()))
		return
	}

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			s.logger.Info("agent connection closed", slog.String("error", err.Error()))
			return
		}

		var envelope protocol.IncomingEnvelope
		if err := json.Unmarshal(data, &envelope); err != nil {
			s.logger.Warn("failed to parse incoming envelope", slog.String("error", err.Error()))
			continue
		}

		switch envelope.Type {
		case "sandbox.hello_ack":
			var ack protocol.SandboxHelloAck
			if err := json.Unmarshal(data, &ack); err != nil {
				s.logger.Warn("failed to parse sandbox.hello_ack", slog.String("error", err.Error()))
				continue
			}
			s.logger.Info("received sandbox.hello_ack", slog.Bool("accepted", ack.Accepted))
		case "rpc.request":
			var request protocol.RPCRequest
			if err := json.Unmarshal(data, &request); err != nil {
				s.logger.Warn("failed to parse rpc.request", slog.String("error", err.Error()))
				continue
			}
			s.logger.Debug("rpc:request received", slog.String("method", request.Method), slog.String("requestId", request.RequestID))
			go s.handleRPCRequest(session, request)
		default:
			s.logger.Warn("unknown incoming message type", slog.String("type", envelope.Type))
		}
	}
}

func (s *Server) replaceActiveSession(session *connectionSession) {
	s.mu.Lock()
	previous := s.active
	s.active = session
	s.dispatcher.SetSender(connSender{session: session})
	s.mu.Unlock()

	if previous != nil && previous != session {
		s.logger.Warn("replacing existing agent connection")
		previous.cancel()
		_ = previous.conn.Close(websocket.StatusPolicyViolation, "replaced by newer connection")
	}
}

func (s *Server) clearActiveSession(session *connectionSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active != session {
		return
	}
	s.active = nil
	s.dispatcher.SetSender(nil)
}

func (s *Server) writeLoop(session *connectionSession) {
	for {
		select {
		case <-session.ctx.Done():
			return
		case payload := <-session.sendCh:
			if err := session.conn.Write(session.ctx, websocket.MessageText, payload); err != nil {
				s.logger.Warn("failed to write websocket message", slog.String("error", err.Error()))
				session.cancel()
				return
			}
		}
	}
}

func (s *Server) handleRPCRequest(session *connectionSession, request protocol.RPCRequest) {
	response := s.dispatcher.Handle(request)
	if response == nil {
		return
	}

	payload, err := json.Marshal(response)
	if err != nil {
		s.logger.Warn("failed to marshal rpc response", slog.String("error", err.Error()))
		return
	}

	switch response.(type) {
	case protocol.RPCError:
		s.logger.Warn("rpc:error", slog.String("method", request.Method), slog.String("requestId", request.RequestID))
	default:
		s.logger.Debug("rpc:response", slog.String("method", request.Method), slog.String("requestId", request.RequestID))
	}

	if err := enqueuePayload(session, payload); err != nil {
		s.logger.Warn(
			"failed to enqueue rpc response",
			slog.String("requestId", request.RequestID),
			slog.String("method", request.Method),
			slog.String("error", err.Error()),
		)
	}
}

func (s *Server) sendHello(session *connectionSession) error {
	hostname, _ := os.Hostname()
	prepareStatus, prepareErr := s.prepareState.Get()
	payload, err := json.Marshal(protocol.SandboxHello{
		Version:   protocol.Version,
		Type:      "sandbox.hello",
		SpaceID:   s.cfg.SpaceID,
		SandboxID: s.hostname,
		Timestamp: time.Now().UnixMilli(),
		Capabilities: protocol.SandboxCapabilities{
			FSRead:       true,
			FSWrite:      true,
			FSStat:       true,
			FSLs:         true,
			FSFind:       true,
			FSGrep:       true,
			ProcessStart: true,
			ProcessAbort: true,
		},
		Filesystem: &protocol.SandboxFilesystem{
			DefaultCwd: s.cfg.WorkspaceDir,
			Mode:       "host-like",
			Notes: []string{
				"sandbox paths follow host-like semantics; cwd defaults to /workspace",
				"/configs/platform/.agents is mounted read-only for platform skills",
			},
			Roots: []protocol.SandboxFilesystemRoot{
				{Path: s.cfg.WorkspaceDir, Writable: true, Label: "cwd"},
				{Path: s.cfg.PlatformAgentsDir, Writable: false, Label: "platform-skills"},
				{Path: "/tmp", Writable: true, Label: "tmp"},
			},
		},
		Metadata: &protocol.SandboxMetadata{
			Hostname:      hostname,
			ImageVersion:  s.cfg.ImageVersion,
			StartedAt:     time.Now().Format(time.RFC3339),
			PrepareStatus: prepareStatus,
			PrepareError:  prepareErr,
		},
	})
	if err != nil {
		return err
	}
	return enqueuePayload(session, payload)
}

func (s *Server) heartbeatLoop(session *connectionSession) {
	ticker := time.NewTicker(time.Duration(env.DefaultHeartbeatSecs) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-session.ctx.Done():
			return
		case <-ticker.C:
			prepareStatus, _ := s.prepareState.Get()
			payload, err := json.Marshal(protocol.SandboxHeartbeat{
				Version:   protocol.Version,
				Type:      "sandbox.heartbeat",
				SpaceID:   s.cfg.SpaceID,
				SandboxID: s.hostname,
				Timestamp: time.Now().UnixMilli(),
				Status:    prepareStatus,
			})
			if err != nil {
				s.logger.Warn("failed to marshal heartbeat", slog.String("error", err.Error()))
				continue
			}
			if err := enqueuePayload(session, payload); err != nil {
				s.logger.Warn("failed to enqueue heartbeat", slog.String("error", err.Error()))
				return
			}
		}
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
