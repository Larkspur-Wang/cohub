package workspace

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/cohub/apps/sandbox/env"
)

const setupScriptTimeout = 60 * time.Second
const setupOutputLimit = 4096 // truncate stdout/stderr to 4KB

type SetupResult struct {
	Ran      bool   `json:"ran"`
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	Duration string `json:"duration"`
	Error    string `json:"error,omitempty"`
}

type PrepareSummary struct {
	WorkspaceDir      string
	PlatformAgentsDir string
	Setup             *SetupResult
}

func Prepare(cfg env.Config, logger *slog.Logger) (PrepareSummary, error) {
	if err := os.MkdirAll(cfg.WorkspaceDir, 0o755); err != nil {
		return PrepareSummary{}, fmt.Errorf("mkdir workspace: %w", err)
	}

	summary := PrepareSummary{
		WorkspaceDir:      cfg.WorkspaceDir,
		PlatformAgentsDir: cfg.PlatformAgentsDir,
	}

	setup := runSetupScript(cfg, logger)
	if setup != nil {
		summary.Setup = setup
	}

	return summary, nil
}

func runSetupScript(cfg env.Config, logger *slog.Logger) *SetupResult {
	scriptPath := filepath.Join(cfg.UserAgentsDir, "setup.sh")
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		logger.Debug("setup.sh not found, skipping")
		return nil
	}

	logger.Info("running setup.sh", slog.String("path", scriptPath))
	started := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), setupScriptTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", scriptPath)
	cmd.Dir = cfg.WorkspaceDir
	// Environment values come from trusted K8s config / pod spec.
	// If setup.sh uses eval or unquoted variable expansion, untrusted input
	// could still pose a risk — scripts must handle this defensively.
	cmd.Env = append(os.Environ(),
		"WORKSPACE_DIR="+cfg.WorkspaceDir,
		"PLATFORM_AGENTS_DIR="+cfg.PlatformAgentsDir,
		"USER_AGENTS_DIR="+cfg.UserAgentsDir,
		"SPACE_ID="+cfg.SpaceID,
	)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	result := &SetupResult{Ran: true}

	err := cmd.Run()
	elapsed := time.Since(started)
	result.Duration = elapsed.Truncate(time.Millisecond).String()

	// Truncate output to avoid bloating heartbeat payload.
	result.Stdout = truncate(stdout.String(), setupOutputLimit)
	result.Stderr = truncate(stderr.String(), setupOutputLimit)

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			result.Error = fmt.Sprintf("setup.sh timed out after %v", setupScriptTimeout)
			logger.Warn("setup.sh timed out", slog.Duration("elapsed", elapsed))
		} else {
			if exitErr, ok := err.(*exec.ExitError); ok {
				result.ExitCode = exitErr.ExitCode()
			} else {
				result.Error = err.Error()
			}
			logger.Warn("setup.sh failed",
				slog.Int("exitCode", result.ExitCode),
				slog.String("error", result.Error),
				slog.Duration("elapsed", elapsed),
			)
		}
	} else {
		logger.Info("setup.sh completed", slog.Duration("elapsed", elapsed))
	}

	return result
}

func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "...[truncated]"
}
