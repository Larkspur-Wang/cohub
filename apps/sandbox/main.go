package main

import (
	"log/slog"
	"os"
	"sync"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
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

	processManager := process.NewManager(logger)
	dispatcher := rpc.NewDispatcher(cfg, processManager, logger)
	server := ws.NewServer(cfg, dispatcher, processManager, state, logger)

	// Run workspace prepare in background (parallel with WS server)
	go func() {
		summary, err := workspace.Prepare(cfg)
		if err != nil {
			logger.Error("workspace prepare failed", slog.String("error", err.Error()))
			state.Set("error", err)
		} else {
			logger.Info("workspace prepared",
				slog.String("workspaceDir", summary.WorkspaceDir),
				slog.Bool("repoCloned", summary.RepoCloned),
			)
			state.Set("ready", nil)
		}
	}()

	if err := server.Run(); err != nil {
		logger.Error("sandbox exited", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
