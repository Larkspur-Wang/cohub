package workspace

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/cohub/apps/sandbox/env"
)

type PrepareSummary struct {
	WorkspaceDir  string
	RepoCloned    bool
	ConfigApplied bool
}

func Prepare(cfg env.Config) (PrepareSummary, error) {
	if err := os.MkdirAll(cfg.WorkspaceDir, 0o755); err != nil {
		return PrepareSummary{}, fmt.Errorf("mkdir workspace: %w", err)
	}

	repoCloned := false
	if cfg.SpaceRepoURL != "" {
		gitDir := filepath.Join(cfg.WorkspaceDir, ".git")
		if _, err := os.Stat(gitDir); os.IsNotExist(err) {
			empty, err := isWorkspaceEmpty(cfg.WorkspaceDir)
			if err != nil {
				return PrepareSummary{}, err
			}
			if empty {
				cmd := exec.Command("git", "clone", cfg.SpaceRepoURL, cfg.WorkspaceDir)
				output, err := cmd.CombinedOutput()
				if err != nil {
					return PrepareSummary{}, fmt.Errorf("git clone failed: %s: %w", string(output), err)
				}
				repoCloned = true
			} else {
				return PrepareSummary{}, fmt.Errorf("workspace directory exists and is not empty, skipping clone")
			}
		}

		if cfg.SpaceGitUsername != "" {
			if err := gitConfig(cfg.WorkspaceDir, "user.name", cfg.SpaceGitUsername); err != nil {
				return PrepareSummary{}, err
			}
		}
		if cfg.SpaceGitEmail != "" {
			if err := gitConfig(cfg.WorkspaceDir, "user.email", cfg.SpaceGitEmail); err != nil {
				return PrepareSummary{}, err
			}
		}
	}

	return PrepareSummary{
		WorkspaceDir:  cfg.WorkspaceDir,
		RepoCloned:    repoCloned,
		ConfigApplied: false,
	}, nil
}

func isWorkspaceEmpty(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, fmt.Errorf("read workspace dir: %w", err)
	}
	for _, entry := range entries {
		if entry.Name() == "lost+found" {
			continue
		}
		return false, nil
	}
	return true, nil
}

func gitConfig(cwd string, key string, value string) error {
	cmd := exec.Command("git", "config", key, value)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git config %s failed: %s: %w", key, string(output), err)
	}
	return nil
}
