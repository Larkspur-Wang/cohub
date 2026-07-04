package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/filewatch"
	"github.com/cohub/apps/sandbox/portwatch"
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

func sandboxWSEndpoint(podIP string) string {
	if strings.TrimSpace(podIP) == "" {
		return ""
	}
	return fmt.Sprintf("ws://%s:%d/sandbox", podIP, env.DefaultSandboxWSPort)
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

func toProtocolPortChanges(changes []portwatch.Change) []protocol.PortChange {
	out := make([]protocol.PortChange, 0, len(changes))
	for _, change := range changes {
		out = append(out, protocol.PortChange{
			Port:       change.Port,
			Protocol:   change.Protocol,
			Status:     protocol.PortStatus(change.Status),
			ObservedAt: change.ObservedAt,
		})
	}
	return out
}

func main() {
	showVersion := flag.Bool("version", false, "print sandbox version and exit")
	flag.Parse()
	if *showVersion {
		version := os.Getenv("IMAGE_VERSION")
		if version == "" {
			version = "unknown"
		}
		fmt.Println(version)
		return
	}

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
	server := ws.NewServer(cfg, dispatcher, processManager, reporter, state, hostname, logger)

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

	if watcher, err := portwatch.Start(cfg.PublicPorts, logger, func(batch portwatch.Batch) {
		server.BroadcastPortsChanged(protocol.PortsChangedPayload{
			Seq:    batch.Seq,
			Resync: batch.Resync,
			Ports:  toProtocolPortChanges(batch.Changes),
		})
	}); err != nil {
		logger.Warn("port watcher disabled", slog.String("error", err.Error()))
	} else {
		defer watcher.Close()
		logger.Info("port watcher started", slog.Any("ports", cfg.PublicPorts))
	}

	initialMeta := map[string]interface{}{
		"hostname":     hostname,
		"imageVersion": cfg.ImageVersion,
		"startedAt":    startedAt,
		"podIp":        cfg.PodIP,
		"wsEndpoint":   sandboxWSEndpoint(cfg.PodIP),
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
					"wsEndpoint":   sandboxWSEndpoint(cfg.PodIP),
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
					"wsEndpoint":        sandboxWSEndpoint(cfg.PodIP),
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
