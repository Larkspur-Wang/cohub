package env

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type FilesystemRoot struct {
	Path     string
	Writable bool
	Label    string
}

type Config struct {
	SandboxWSHost         string
	SandboxWSPort         int
	SpaceID               string
	SandboxID             string
	WorkspaceDir          string
	PlatformAgentsDir     string
	HeartbeatIntervalSecs int
	ImageVersion          string
	GlobalConfigRepo      string
	SpaceRepoURL          string
	SpaceGitUsername      string
	SpaceGitEmail         string
	PodName               string
	PodNamespace          string
	PodIP                 string
	InternalAPIBaseURL    string
	SandboxReportToken    string
	PublicURLPrefix       string
}

func Load() (Config, error) {
	wsHost := strings.TrimSpace(os.Getenv("SANDBOX_WS_HOST"))
	if wsHost == "" {
		wsHost = "0.0.0.0"
	}

	wsPort := 8788
	if value := strings.TrimSpace(os.Getenv("SANDBOX_WS_PORT")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return Config{}, fmt.Errorf("invalid SANDBOX_WS_PORT: %w", err)
		}
		wsPort = parsed
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

	platformAgentsDir := strings.TrimSpace(os.Getenv("PLATFORM_AGENTS_DIR"))
	if platformAgentsDir == "" {
		platformAgentsDir = "/configs/platform/.agents"
	}
	platformAgentsDir = filepath.Clean(platformAgentsDir)

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
		SandboxWSHost:         wsHost,
		SandboxWSPort:         wsPort,
		SpaceID:               spaceID,
		SandboxID:             sandboxID,
		WorkspaceDir:          workspaceDir,
		PlatformAgentsDir:     platformAgentsDir,
		HeartbeatIntervalSecs: heartbeatIntervalSecs,
		ImageVersion:          imageVersion,
		GlobalConfigRepo:      globalConfigRepo,
		SpaceRepoURL:          strings.TrimSpace(os.Getenv("SPACE_REPO_URL")),
		SpaceGitUsername:      strings.TrimSpace(os.Getenv("SPACE_GIT_USERNAME")),
		SpaceGitEmail:         strings.TrimSpace(os.Getenv("SPACE_GIT_EMAIL")),
		PodName:               strings.TrimSpace(os.Getenv("POD_NAME")),
		PodNamespace:          strings.TrimSpace(os.Getenv("POD_NAMESPACE")),
		PodIP:                 strings.TrimSpace(os.Getenv("POD_IP")),
		InternalAPIBaseURL:    strings.TrimSpace(os.Getenv("INTERNAL_API_BASE_URL")),
		SandboxReportToken:    strings.TrimSpace(os.Getenv("SANDBOX_REPORT_TOKEN")),
		PublicURLPrefix:       strings.TrimSpace(os.Getenv("PUBLIC_URL_PREFIX")),
	}, nil
}

func (c Config) FilesystemRoots() []FilesystemRoot {
	return []FilesystemRoot{
		{Path: c.WorkspaceDir, Writable: true, Label: "cwd"},
		{Path: c.PlatformAgentsDir, Writable: false, Label: "platform-skills"},
		{Path: "/tmp", Writable: true, Label: "tmp"},
	}
}
