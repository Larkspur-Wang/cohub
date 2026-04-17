package main

import (
	"log/slog"
	"os"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/rpc"
	"github.com/cohub/apps/sandbox/ws"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := env.Load()
	if err != nil {
		logger.Error("failed to load env", slog.String("error", err.Error()))
		os.Exit(1)
	}

	processManager := process.NewManager(logger)
	dispatcher := rpc.NewDispatcher(cfg, processManager, logger)
	client := ws.NewClient(cfg, dispatcher, logger)

	if err := client.Run(); err != nil {
		logger.Error("sandbox exited", slog.String("error", err.Error()))
		os.Exit(1)
	}
}
