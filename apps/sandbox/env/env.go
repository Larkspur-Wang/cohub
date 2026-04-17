package env

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	SandboxWSURL          string
	SpaceID               string
	SandboxID             string
	WorkspaceDir          string
	HeartbeatIntervalSecs int
	ImageVersion          string
	GlobalConfigRepo      string
	SpaceRepoURL          string
	SpaceGitUsername      string
	SpaceGitEmail         string
}

func Load() (Config, error) {
	wsURL := strings.TrimSpace(os.Getenv("SANDBOX_WS_URL"))
	if wsURL == "" {
		return Config{}, fmt.Errorf("SANDBOX_WS_URL is required")
	}

	spaceID := strings.TrimSpace(os.Getenv("SPACE_ID"))
	if spaceID == "" {
		return Config{}, fmt.Errorf("SPACE_ID is required")
	}

	workspaceDir := strings.TrimSpace(os.Getenv("WORKSPACE_DIR"))
	if workspaceDir == "" {
		workspaceDir = "/workspace"
	}
	workspaceDir = filepath.Clean(workspaceDir)

	heartbeatIntervalSecs := 5
	if value := strings.TrimSpace(os.Getenv("HEARTBEAT_INTERVAL_SECS")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return Config{}, fmt.Errorf("invalid HEARTBEAT_INTERVAL_SECS: %w", err)
		}
		heartbeatIntervalSecs = parsed
	}

	sandboxID := strings.TrimSpace(os.Getenv("SANDBOX_ID"))
	if sandboxID == "" {
		sandboxID = "sandbox-dev"
	}

	imageVersion := strings.TrimSpace(os.Getenv("IMAGE_VERSION"))
	if imageVersion == "" {
		imageVersion = "dev"
	}

	globalConfigRepo := strings.TrimSpace(os.Getenv("GLOBAL_CONFIG_REPO"))
	if globalConfigRepo == "" {
		globalConfigRepo = "https://gitea.cohub.run/global/configs.git"
	}

	return Config{
		SandboxWSURL:          wsURL,
		SpaceID:               spaceID,
		SandboxID:             sandboxID,
		WorkspaceDir:          workspaceDir,
		HeartbeatIntervalSecs: heartbeatIntervalSecs,
		ImageVersion:          imageVersion,
		GlobalConfigRepo:      globalConfigRepo,
		SpaceRepoURL:          strings.TrimSpace(os.Getenv("SPACE_REPO_URL")),
		SpaceGitUsername:      strings.TrimSpace(os.Getenv("SPACE_GIT_USERNAME")),
		SpaceGitEmail:         strings.TrimSpace(os.Getenv("SPACE_GIT_EMAIL")),
	}, nil
}
