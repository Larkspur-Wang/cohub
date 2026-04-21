package workspace

import (
	"fmt"
	"os"

	"github.com/cohub/apps/sandbox/env"
)

type PrepareSummary struct {
	WorkspaceDir      string
	PlatformAgentsDir string
}

func Prepare(cfg env.Config) (PrepareSummary, error) {
	if err := os.MkdirAll(cfg.WorkspaceDir, 0o755); err != nil {
		return PrepareSummary{}, fmt.Errorf("mkdir workspace: %w", err)
	}

	return PrepareSummary{
		WorkspaceDir:      cfg.WorkspaceDir,
		PlatformAgentsDir: cfg.PlatformAgentsDir,
	}, nil
}
