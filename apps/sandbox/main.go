package main

import (
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/report"
	"github.com/cohub/apps/sandbox/rpc"
	"github.com/cohub/apps/sandbox/workspace"
	"github.com/cohub/apps/sandbox/ws"
)

type prepareState struct {
	mu     sync.RWMutex
	status string // "preparing" | "ready" | "error"
	err    string
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

func (s *prepareState) Get() (string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status, s.err
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
	reporter := report.NewClient(cfg)

	processManager := process.NewManager(logger)
	dispatcher := rpc.NewDispatcher(cfg, processManager, logger)
	server := ws.NewServer(cfg, dispatcher, processManager, state, logger)

	if err := reporter.Report(report.Payload{
		Status:    "provisioning",
		SandboxID: cfg.SandboxID,
		Meta: map[string]interface{}{
			"podName":       cfg.PodName,
			"hostname":      hostname,
			"imageVersion":  cfg.ImageVersion,
			"prepareStatus": "preparing",
			"startedAt":     startedAt,
		},
	}); err != nil {
		logger.Warn("failed to report sandbox provisioning", slog.String("error", err.Error()))
	}

	// Run workspace prepare in background (parallel with WS server)
	go func() {
		summary, err := workspace.Prepare(cfg)
		if err != nil {
			logger.Error("workspace prepare failed", slog.String("error", err.Error()))
			state.Set("error", err)
			if reportErr := reporter.Report(report.Payload{
				Status:    "error",
				SandboxID: cfg.SandboxID,
				Meta: map[string]interface{}{
					"podName":       cfg.PodName,
					"hostname":      hostname,
					"imageVersion":  cfg.ImageVersion,
					"prepareStatus": "error",
					"prepareError":  err.Error(),
				},
			}); reportErr != nil {
				logger.Warn("failed to report sandbox error", slog.String("error", reportErr.Error()))
			}
		} else {
			logger.Info("workspace prepared",
				slog.String("workspaceDir", summary.WorkspaceDir),
				slog.String("platformAgentsDir", summary.PlatformAgentsDir),
				slog.Bool("repoCloned", summary.RepoCloned),
			)
			state.Set("ready", nil)
			if reportErr := reporter.Report(report.Payload{
				Status:    "ready",
				SandboxID: cfg.SandboxID,
				Meta: map[string]interface{}{
					"podName":           cfg.PodName,
					"podIp":             cfg.PodIP,
					"hostname":          hostname,
					"imageVersion":      cfg.ImageVersion,
					"prepareStatus":     "ready",
					"preparedAt":        time.Now().UTC().Format(time.RFC3339),
					"workspaceDir":      summary.WorkspaceDir,
					"platformAgentsDir": summary.PlatformAgentsDir,
					"repoCloned":        summary.RepoCloned,
					"configApplied":     summary.ConfigApplied,
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
