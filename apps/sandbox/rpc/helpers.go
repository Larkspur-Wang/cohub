package rpc

import (
	"encoding/base64"
	"net/http"
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

func osReadFileBytes(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func fileToBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// detectMimeType uses file extension first, then content sniffing as fallback.
func detectMimeType(path string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	imageTypes := map[string]string{
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".png":  "image/png",
		".gif":  "image/gif",
		".webp": "image/webp",
		".svg":  "image/svg+xml",
		".bmp":  "image/bmp",
		".ico":  "image/x-icon",
	}
	if mt, ok := imageTypes[ext]; ok {
		return mt
	}
	// Fallback: sniff content bytes.
	return http.DetectContentType(data)
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
	roots := []string{
		filepath.Clean(cfg.PlatformAgentsDir),
		filepath.Clean(cfg.UserAgentsDir),
	}
	candidate := filepath.Clean(path)
	for _, root := range roots {
		if candidate == root || strings.HasPrefix(candidate, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}
