package main

import (
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/filewatch"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/protocol"
	"github.com/cohub/apps/sandbox/report"
	"github.com/cohub/apps/sandbox/rpc"
	"github.com/cohub/apps/sandbox/workspace"
	"github.com/cohub/apps/sandbox/ws"
)

type prepareState struct {
	mu     sync.RWMutex
	status string // "preparing" | "ready" | "degraded" | "error"
	err    string
	setup  *protocol.SandboxSetupInfo
}

func (s *prepareState) Set(status string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
	if err != nil {
		s.err = err.Error()
	} else {
		s.err = ""
	}
}

func (s *prepareState) SetSetup(setup *protocol.SandboxSetupInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.setup = setup
}

func (s *prepareState) Get() (string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status, s.err
}

func (s *prepareState) GetSetup() *protocol.SandboxSetupInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.setup
}

func toProtocolFSChanges(changes []filewatch.Change) []protocol.FSChange {
	out := make([]protocol.FSChange, 0, len(changes))
	for _, change := range changes {
		out = append(out, protocol.FSChange{
			Path:     change.Path,
			OldPath:  change.OldPath,
			Kind:     change.Kind,
			NodeType: change.NodeType,
			MtimeMs:  change.MtimeMs,
			Size:     change.Size,
		})
	}
	return out
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := env.Load()
	if err != nil {
		logger.Error("failed to load env", slog.String("error", err.Error()))
		os.Exit(1)
	}

	state := &prepareState{status: "preparing"}
	startedAt := time.Now().UTC().Format(time.RFC3339)
	hostname, _ := os.Hostname()
	reporter := report.NewClient(cfg, hostname)

	processManager := process.NewManager(logger)
	dispatcher := rpc.NewDispatcher(cfg, processManager, logger)
	server := ws.NewServer(cfg, dispatcher, processManager, state, hostname, logger)

	if watcher, err := filewatch.Start(cfg.WorkspaceDir, logger, func(batch filewatch.Batch) {
		server.BroadcastFSChanged(protocol.FSChangedPayload{
			Seq:     batch.Seq,
			Resync:  batch.Resync,
			Changes: toProtocolFSChanges(batch.Changes),
		})
	}); err != nil {
		logger.Warn("file watcher disabled", slog.String("error", err.Error()))
	} else {
		defer watcher.Close()
		logger.Info("file watcher started", slog.String("workspaceDir", cfg.WorkspaceDir))
	}

	initialMeta := map[string]interface{}{
		"hostname":     hostname,
		"imageVersion": cfg.ImageVersion,
		"startedAt":    startedAt,
		"podIp":        cfg.PodIP,
	}
	if err := reporter.Report(report.Payload{
		Status: "provisioning",
		Meta:   initialMeta,
	}); err != nil {
		logger.Warn("failed to report sandbox provisioning", slog.String("error", err.Error()))
	}

	// Ensure workspace mount exists in background while WS server starts.
	go func() {
		summary, err := workspace.Prepare(cfg, logger)
		if err != nil {
			logger.Error("workspace prepare failed", slog.String("error", err.Error()))
			state.Set("error", err)
			if reportErr := reporter.Report(report.Payload{
				Status: "error",
				Meta: map[string]interface{}{
					"hostname":     hostname,
					"imageVersion": cfg.ImageVersion,
					"lastError":    err.Error(),
					"podIp":        cfg.PodIP,
				},
			}); reportErr != nil {
				logger.Warn("failed to report sandbox error", slog.String("error", reportErr.Error()))
			}
		} else {
			// Persist setup result into state for heartbeat visibility.
			// Both SetSetup and Set are called sequentially in the same goroutine;
			// heartbeat reads use GetSetup/Get with RLock, so race risk is negligible.
			if summary.Setup != nil {
				si := &protocol.SandboxSetupInfo{
					Ran:      summary.Setup.Ran,
					ExitCode: summary.Setup.ExitCode,
					Stdout:   summary.Setup.Stdout,
					Stderr:   summary.Setup.Stderr,
					Duration: summary.Setup.Duration,
					Error:    summary.Setup.Error,
				}
				state.SetSetup(si)
				if summary.Setup.ExitCode != 0 || summary.Setup.Error != "" {
					state.Set("degraded", nil)
				}
			}

			logger.Info("workspace mount ready",
				slog.String("workspaceDir", summary.WorkspaceDir),
				slog.String("platformAgentsDir", summary.PlatformAgentsDir),
				slog.String("userAgentsDir", cfg.UserAgentsDir),
			)
			currentStatus, _ := state.Get()
			if currentStatus == "preparing" {
				state.Set("ready", nil)
			}
			if reportErr := reporter.Report(report.Payload{
				Status: state.status,
				Meta: map[string]interface{}{
					"hostname":          hostname,
					"imageVersion":      cfg.ImageVersion,
					"workspaceDir":      summary.WorkspaceDir,
					"platformAgentsDir": summary.PlatformAgentsDir,
					"userAgentsDir":     cfg.UserAgentsDir,
					"podIp":             cfg.PodIP,
				},
			}); reportErr != nil {
				logger.Warn("failed to report sandbox ready", slog.String("error", reportErr.Error()))
			}
		}
	}()

	if err := server.Run(); err != nil {
		logger.Error("sandbox exited", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
