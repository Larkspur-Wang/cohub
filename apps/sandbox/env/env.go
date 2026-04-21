package env

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type FilesystemRoot struct {
	Path     string
	Writable bool
	Label    string
}

const (
	DefaultSandboxWSHost = "0.0.0.0"
	DefaultSandboxWSPort = 8788
	DefaultHeartbeatSecs = 5
)

type Config struct {
	SpaceID            string
	WorkspaceDir       string
	PlatformAgentsDir  string
	ImageVersion       string
	SpaceRepoURL       string
	InternalAPIBaseURL string
	SandboxReportToken string
	PublicURLPrefix    string
	PodIP              string
}

func Load() (Config, error) {
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

	imageVersion := strings.TrimSpace(os.Getenv("IMAGE_VERSION"))
	if imageVersion == "" {
		imageVersion = "dev"
	}

	return Config{
		SpaceID:            spaceID,
		WorkspaceDir:       workspaceDir,
		PlatformAgentsDir:  platformAgentsDir,
		ImageVersion:       imageVersion,
		SpaceRepoURL:       strings.TrimSpace(os.Getenv("SPACE_REPO_URL")),
		InternalAPIBaseURL: strings.TrimSpace(os.Getenv("INTERNAL_API_BASE_URL")),
		SandboxReportToken: strings.TrimSpace(os.Getenv("SANDBOX_REPORT_TOKEN")),
		PublicURLPrefix:    strings.TrimSpace(os.Getenv("PUBLIC_URL_PREFIX")),
		PodIP:              strings.TrimSpace(os.Getenv("POD_IP")),
	}, nil
}

func (c Config) FilesystemRoots() []FilesystemRoot {
	return []FilesystemRoot{
		{Path: c.WorkspaceDir, Writable: true, Label: "cwd"},
		{Path: c.PlatformAgentsDir, Writable: false, Label: "platform-skills"},
		{Path: "/tmp", Writable: true, Label: "tmp"},
	}
}
