package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

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

// reportStatus calls the internal API to update the sandbox status in DB.
func reportStatus(cfg env.Config, status string, prepareErr error) {
	body := map[string]any{
		"status": status,
		"meta": map[string]any{
			"preparedAt": time.Now().Format(time.RFC3339),
		},
	}
	if prepareErr != nil {
		body["status"] = "error"
		body["meta"] = map[string]any{
			"lastError": prepareErr.Error(),
		}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		slog.Error("failed to marshal status report", slog.String("error", err.Error()))
		return
	}

	url := cfg.CohubApiUrl + "/internal/spaces/" + cfg.SpaceID + "/status"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		slog.Error("failed to create status report request", slog.String("error", err.Error()))
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("failed to report sandbox status (will retry)",
			slog.String("url", url),
			slog.String("error", err.Error()),
		)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		slog.Info("reported sandbox status to API",
			slog.String("status", status),
			slog.Int("httpStatus", resp.StatusCode),
		)
	} else {
		slog.Warn("sandbox status report returned non-2xx",
			slog.Int("httpStatus", resp.StatusCode),
		)
	}
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
			reportStatus(cfg, "error", err)
		} else {
			logger.Info("workspace prepared",
				slog.String("workspaceDir", summary.WorkspaceDir),
				slog.Bool("repoCloned", summary.RepoCloned),
			)
			state.Set("ready", nil)
			reportStatus(cfg, "ready", nil)
		}
	}()

	if err := server.Run(); err != nil {
		logger.Error("sandbox exited", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
