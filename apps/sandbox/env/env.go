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

const (
	DefaultSandboxWSHost = "0.0.0.0"
	DefaultSandboxWSPort = 8788
	DefaultHeartbeatSecs = 5
)

type Config struct {
	SpaceID                        string
	WorkspaceDir                   string
	PlatformAgentsDir              string
	PlatformAgentDir               string
	UserConfigDir                  string
	ImageVersion                   string
	InternalAPIBaseURL             string
	SandboxReportToken             string
	PublicURLPrefix                string
	PodIP                          string
	ZombieSelfHealThreshold        int
	ZombieSelfHealConsecutiveTicks int
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

	platformAgentDir := strings.TrimSpace(os.Getenv("PLATFORM_AGENT_DIR"))
	if platformAgentDir == "" {
		platformAgentDir = "/configs/platform/.pi/agent"
	}
	platformAgentDir = filepath.Clean(platformAgentDir)

	userConfigDir := strings.TrimSpace(os.Getenv("USER_CONFIG_DIR"))
	if userConfigDir == "" {
		userConfigDir = "/configs/user"
	}
	userConfigDir = filepath.Clean(userConfigDir)

	imageVersion := strings.TrimSpace(os.Getenv("IMAGE_VERSION"))
	if imageVersion == "" {
		imageVersion = "sandbox:dev"
	}

	return Config{
		SpaceID:                        spaceID,
		WorkspaceDir:                   workspaceDir,
		PlatformAgentsDir:              platformAgentsDir,
		PlatformAgentDir:               platformAgentDir,
		UserConfigDir:                  userConfigDir,
		ImageVersion:                   imageVersion,
		InternalAPIBaseURL:             strings.TrimSpace(os.Getenv("INTERNAL_API_BASE_URL")),
		SandboxReportToken:             strings.TrimSpace(os.Getenv("SANDBOX_REPORT_TOKEN")),
		PublicURLPrefix:                strings.TrimSpace(os.Getenv("PUBLIC_URL_PREFIX")),
		PodIP:                          strings.TrimSpace(os.Getenv("POD_IP")),
		ZombieSelfHealThreshold:        parseIntEnv("ZOMBIE_SELF_HEAL_THRESHOLD", 0),
		ZombieSelfHealConsecutiveTicks: parseIntEnv("ZOMBIE_SELF_HEAL_CONSECUTIVE_TICKS", 3),
	}, nil
}

func parseIntEnv(name string, defaultValue int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return defaultValue
	}
	if value < 0 {
		return 0
	}
	return value
}

func (c Config) FilesystemRoots() []FilesystemRoot {
	return []FilesystemRoot{
		{Path: c.WorkspaceDir, Writable: true, Label: "cwd"},
		{Path: c.PlatformAgentsDir, Writable: false, Label: "platform-skills"},
		{Path: c.PlatformAgentDir, Writable: false, Label: "platform-agent"},
		{Path: c.UserConfigDir, Writable: false, Label: "user-config"},
		{Path: "/tmp", Writable: true, Label: "tmp"},
	}
}
