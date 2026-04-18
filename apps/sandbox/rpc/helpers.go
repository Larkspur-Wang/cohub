package rpc

import (
	"os"
	"path/filepath"
	"strings"
	"time"
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
