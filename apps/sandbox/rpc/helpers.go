package rpc

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cohub/apps/sandbox/env"
)

func ensureParentDir(path string) error {
	return os.MkdirAll(filepath.Dir(path), 0o755)
}

func osWriteFile(path string, content []byte) error {
	return os.WriteFile(path, content, 0o644)
}

func osReadFile(path string) (string, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func osReadDir(path string) ([]os.DirEntry, error) {
	return os.ReadDir(path)
}

func splitLines(content string) []string {
	return strings.Split(content, "\n")
}

func joinLines(lines []string) string {
	return strings.Join(lines, "\n")
}

func nowMS() int64 {
	return time.Now().UnixMilli()
}

type resolvedSandboxPath struct {
	path string
}

func resolveSandboxPath(cfg env.Config, rawPath string, cwd string) (resolvedSandboxPath, error) {
	base := strings.TrimSpace(cwd)
	if base == "" {
		base = cfg.WorkspaceDir
	}

	candidate := strings.TrimSpace(rawPath)
	if candidate == "" || candidate == "." {
		candidate = base
	}

	var cleaned string
	if filepath.IsAbs(candidate) {
		cleaned = filepath.Clean(candidate)
	} else {
		cleaned = filepath.Clean(filepath.Join(base, candidate))
	}

	return resolvedSandboxPath{path: cleaned}, nil
}

func isReadOnlyPath(cfg env.Config, path string) bool {
	root := filepath.Clean(cfg.PlatformAgentsDir)
	candidate := filepath.Clean(path)
	return candidate == root || strings.HasPrefix(candidate, root+string(filepath.Separator))
}
