package rpc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/protocol"
)

type Sender interface {
	SendJSON(v interface{}) error
}

type Dispatcher struct {
	cfg            env.Config
	processManager *process.Manager
	logger         *slog.Logger
	sender         Sender
	mu             sync.Mutex
}

func NewDispatcher(cfg env.Config, processManager *process.Manager, logger *slog.Logger) *Dispatcher {
	return &Dispatcher{cfg: cfg, processManager: processManager, logger: logger}
}

func (d *Dispatcher) SetSender(sender Sender) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.sender = sender
}

func (d *Dispatcher) Handle(request protocol.RPCRequest) interface{} {
	switch request.Method {
	case "fs.read":
		return d.handleFSRead(request)
	case "fs.write":
		return d.handleFSWrite(request)
	case "fs.stat":
		return d.handleFSStat(request)
	case "fs.ls":
		return d.handleFSLs(request)
	case "fs.find":
		return d.handleFSFind(request)
	case "fs.grep":
		return d.handleFSGrep(request)
	case "process.start":
		return d.handleProcessStart(request)
	case "process.abort":
		return d.handleProcessAbort(request)
	default:
		return d.errorResponse(request, "UNSUPPORTED_METHOD", fmt.Sprintf("unsupported method: %s", request.Method))
	}
}

type fsReadParams struct {
	Path   string `json:"path"`
	CWD    string `json:"cwd"`
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
	Binary bool   `json:"binary"`
}

type fsWriteParams struct {
	Path    string `json:"path"`
	CWD     string `json:"cwd"`
	Content string `json:"content"`
}

type fsLsParams struct {
	Path  string `json:"path"`
	CWD   string `json:"cwd"`
	Limit int    `json:"limit"`
}

type fsFindParams struct {
	Pattern    string   `json:"pattern"`
	Path       string   `json:"path"`
	CWD        string   `json:"cwd"`
	Limit      int      `json:"limit"`
	Mode       string   `json:"mode"`
	Hidden     bool     `json:"hidden"`
	RequireGit bool     `json:"requireGit"`
	IgnoreVcs  bool     `json:"ignoreVcs"`
	FullPath   bool     `json:"fullPath"`
	Ignore     []string `json:"ignore"`
}

type fsGrepParams struct {
	Pattern    string `json:"pattern"`
	Path       string `json:"path"`
	CWD        string `json:"cwd"`
	Glob       string `json:"glob"`
	IgnoreCase bool   `json:"ignoreCase"`
	Literal    bool   `json:"literal"`
	Context    int    `json:"context"`
	Limit      int    `json:"limit"`
	MaxCount   int    `json:"maxCount"`
	JSON       bool   `json:"json"`
	RequireGit bool   `json:"requireGit"`
	IgnoreVcs  bool   `json:"ignoreVcs"`
	Hidden     bool   `json:"hidden"`
}

type processStartParams struct {
	Command     string `json:"command"`
	TimeoutSecs int    `json:"timeoutSecs"`
	CWD         string `json:"cwd"`
}

type processAbortParams struct {
	ProcessID string `json:"processId"`
}

func (d *Dispatcher) resolvePathForRequest(request protocol.RPCRequest, rawPath string, cwd string) (resolvedSandboxPath, interface{}, bool) {
	resolved, err := resolveSandboxPath(d.cfg, rawPath, cwd)
	if err != nil {
		return resolvedSandboxPath{}, d.errorResponse(request, "INVALID_PATH", err.Error()), false
	}
	return resolved, nil, true
}

func (d *Dispatcher) handleFSRead(request protocol.RPCRequest) interface{} {
	var params fsReadParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	// Binary mode: return base64-encoded content with MIME type detection.
	if params.Binary {
		rawBytes, err := osReadFileBytes(resolved.path)
		if err != nil {
			if os.IsNotExist(err) {
				return d.errorResponse(request, "NOT_FOUND", err.Error())
			}
			return d.errorResponse(request, "IO_ERROR", err.Error())
		}
		mimeType := detectMimeType(resolved.path, rawBytes)
		return d.response(request, map[string]interface{}{
			"path":          resolved.path,
			"content":       "",
			"contentBase64": fileToBase64(rawBytes),
			"mimeType":      mimeType,
		})
	}

	content, err := osReadFile(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return d.errorResponse(request, "NOT_FOUND", err.Error())
		}
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}

	lines := splitLines(content)
	start := 0
	if params.Offset > 1 {
		start = params.Offset - 1
	}
	if start < 0 {
		start = 0
	}
	if start > len(lines) {
		start = len(lines)
	}

	end := len(lines)
	if params.Limit > 0 && start+params.Limit < end {
		end = start + params.Limit
	}

	return d.response(request, map[string]interface{}{
		"path":    resolved.path,
		"content": joinLines(lines[start:end]),
	})
}

func (d *Dispatcher) handleFSWrite(request protocol.RPCRequest) interface{} {
	var params fsWriteParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}
	if isReadOnlyPath(d.cfg, resolved.path) {
		return d.errorResponse(request, "READ_ONLY_FILESYSTEM", fmt.Sprintf("path is read-only: %s", resolved.path))
	}
	if info, err := os.Stat(resolved.path); err == nil && info.IsDir() {
		return d.errorResponse(request, "NOT_DIRECTORY", fmt.Sprintf("cannot write to a directory: %s", resolved.path))
	}

	if err := ensureParentDir(resolved.path); err != nil {
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}
	if err := osWriteFile(resolved.path, []byte(params.Content)); err != nil {
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}

	return d.response(request, map[string]interface{}{
		"path":         resolved.path,
		"bytesWritten": len([]byte(params.Content)),
	})
}

type fsStatParams struct {
	Path string `json:"path"`
	CWD  string `json:"cwd"`
}

func (d *Dispatcher) handleFSStat(request protocol.RPCRequest) interface{} {
	var params fsStatParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	info, err := os.Stat(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return d.response(request, map[string]interface{}{
				"path":        resolved.path,
				"exists":      false,
				"isDirectory": false,
			})
		}
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}

	return d.response(request, map[string]interface{}{
		"path":        resolved.path,
		"exists":      true,
		"isDirectory": info.IsDir(),
	})
}

func (d *Dispatcher) handleFSLs(request protocol.RPCRequest) interface{} {
	var params fsLsParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	info, err := os.Stat(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return d.errorResponse(request, "NOT_FOUND", err.Error())
		}
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}
	if !info.IsDir() {
		return d.errorResponse(request, "NOT_DIRECTORY", fmt.Sprintf("not a directory: %s", resolved.path))
	}

	entries, err := osReadDir(resolved.path)
	if err != nil {
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}

	results := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() {
			name += "/"
		}
		results = append(results, name)
	}
	sort.Slice(results, func(i, j int) bool {
		return strings.ToLower(results[i]) < strings.ToLower(results[j])
	})

	limit := params.Limit
	if limit <= 0 {
		limit = 500
	}
	truncated := len(results) > limit
	if truncated {
		results = results[:limit]
	}

	return d.response(request, map[string]interface{}{
		"path":      resolved.path,
		"entries":   results,
		"truncated": truncated,
	})
}

func (d *Dispatcher) handleFSFind(request protocol.RPCRequest) interface{} {
	var params fsFindParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	limit := params.Limit
	if limit <= 0 {
		limit = 1000
	}

	// Build fd arguments based on agent-controlled parameters.
	// Sandbox is a generic executor; agent owns all tool semantics.
	args := []string{"--color=never"}

	// Search mode: glob (default), regex, or fixed-strings.
	switch params.Mode {
	case "glob":
		args = append(args, "--glob")
	case "fixed-strings":
		args = append(args, "--fixed-strings")
		// "regex" is fd default, no flag needed.
	}

	if params.Hidden {
		args = append(args, "--hidden")
	}
	// --no-require-git: apply .gitignore even outside a git repo (agent default).
	if !params.RequireGit {
		args = append(args, "--no-require-git")
	}
	// --no-ignore-vcs: skip all VCS ignore rules.
	if params.IgnoreVcs {
		args = append(args, "--no-ignore-vcs")
	}
	if params.FullPath {
		args = append(args, "--full-path")
	}

	// Add ignore patterns as --exclude flags.
	for _, pattern := range params.Ignore {
		if pattern != "" {
			args = append(args, "--exclude", pattern)
		}
	}

	args = append(args, "--max-results", fmt.Sprintf("%d", limit))
	args = append(args, params.Pattern, resolved.path)

	cmd := exec.Command("fd", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(err.Error(), "executable file not found") {
			return d.errorResponse(request, "INTERNAL_ERROR", "fd is not installed in sandbox")
		}
		stderr := strings.TrimSpace(string(output))
		if stderr == "" {
			stderr = err.Error()
		}
		return d.errorResponse(request, "IO_ERROR", stderr)
	}

	matches := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if line == "" {
			continue
		}
		relativePath, relErr := filepath.Rel(resolved.path, line)
		if relErr != nil {
			matches = append(matches, line)
		} else {
			matches = append(matches, filepath.ToSlash(relativePath))
		}
	}
	truncated := len(matches) > limit
	if truncated {
		matches = matches[:limit]
	}

	return d.response(request, map[string]interface{}{
		"path":      resolved.path,
		"matches":   matches,
		"truncated": truncated,
	})
}

func (d *Dispatcher) handleFSGrep(request protocol.RPCRequest) interface{} {
	var params fsGrepParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	limit := params.Limit
	if limit <= 0 {
		limit = 100
	}

	args := []string{"--line-number", "--color=never"}
	if params.Hidden {
		args = append(args, "--hidden")
	}
	// --no-require-git: apply .gitignore even outside a git repo (agent default).
	if !params.RequireGit {
		args = append(args, "--no-require-git")
	}
	// --no-ignore-vcs: skip all VCS ignore rules.
	if params.IgnoreVcs {
		args = append(args, "--no-ignore-vcs")
	}
	if params.MaxCount > 0 {
		args = append(args, "--max-count", fmt.Sprintf("%d", params.MaxCount))
	}
	if params.JSON {
		args = append(args, "--json")
	}
	if params.Context > 0 {
		args = append(args, "--context", fmt.Sprintf("%d", params.Context))
	}
	if params.IgnoreCase {
		args = append(args, "--ignore-case")
	}
	if params.Literal {
		args = append(args, "--fixed-strings")
	}
	if strings.TrimSpace(params.Glob) != "" {
		args = append(args, "--glob", params.Glob)
	}
	args = append(args, params.Pattern, resolved.path)

	cmd := exec.Command("rg", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if exec.ErrNotFound != nil && strings.Contains(err.Error(), exec.ErrNotFound.Error()) {
			return d.errorResponse(request, "INTERNAL_ERROR", "rg is not installed in sandbox")
		}
		stderr := strings.TrimSpace(string(output))
		if stderr == "" {
			stderr = err.Error()
		}
		if !strings.Contains(stderr, "No files were searched") && !strings.Contains(stderr, "No such file or directory") {
			return d.errorResponse(request, "IO_ERROR", stderr)
		}
	}

	lines := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	truncated := len(lines) > limit
	if truncated {
		lines = lines[:limit]
	}

	return d.response(request, map[string]interface{}{
		"path":      resolved.path,
		"lines":     lines,
		"truncated": truncated,
	})
}

func (d *Dispatcher) handleProcessStart(request protocol.RPCRequest) interface{} {
	var params processStartParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	cmdSummary := strings.TrimSpace(params.Command)
	if len(cmdSummary) > 80 {
		cmdSummary = cmdSummary[:80]
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.CWD, d.cfg.WorkspaceDir)
	if !ok {
		return errResponse
	}

	info, err := os.Stat(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return d.errorResponse(request, "NOT_FOUND", err.Error())
		}
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}
	if !info.IsDir() {
		return d.errorResponse(request, "NOT_DIRECTORY", fmt.Sprintf("not a directory: %s", resolved.path))
	}

	processID, stdout, stderr, exitCh, err := d.processManager.Start(params.Command, resolved.path, params.TimeoutSecs)
	if err != nil {
		d.logger.Error("process:start failed", slog.String("cmd", cmdSummary), slog.String("error", err.Error()))
		return d.errorResponse(request, "PROCESS_SPAWN_FAILED", err.Error())
	}
	d.logger.Info("process:start", slog.String("processId", processID), slog.String("cmd", cmdSummary), slog.String("cwd", resolved.path))

	_ = d.sendStream(request, protocol.RPCStreamEvent{Type: "started", ProcessID: processID})

	go func() {
		_ = process.StreamLines(stdout, func(line string) {
			_ = d.sendStream(request, protocol.RPCStreamEvent{Type: "stdout", Chunk: line})
		})
	}()
	go func() {
		_ = process.StreamLines(stderr, func(line string) {
			_ = d.sendStream(request, protocol.RPCStreamEvent{Type: "stderr", Chunk: line})
		})
	}()
	go func() {
		exitCode := <-exitCh
		codeStr := "unknown"
		if exitCode != nil {
			codeStr = fmt.Sprintf("%d", *exitCode)
		}
		d.logger.Info("process:exit", slog.String("processId", processID), slog.String("exitCode", codeStr), slog.String("cmd", cmdSummary))
		_ = d.sendStream(request, protocol.RPCStreamEvent{Type: "exit", ExitCode: exitCode})
	}()

	return d.response(request, map[string]interface{}{
		"processId": processID,
	})
}

func (d *Dispatcher) handleProcessAbort(request protocol.RPCRequest) interface{} {
	var params processAbortParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	if err := d.processManager.Abort(params.ProcessID); err != nil {
		d.logger.Warn("process:abort failed", slog.String("processId", params.ProcessID), slog.String("error", err.Error()))
		return d.errorResponse(request, "PROCESS_ABORT_FAILED", err.Error())
	}
	d.logger.Info("process:abort", slog.String("processId", params.ProcessID))

	return d.response(request, map[string]interface{}{
		"processId": params.ProcessID,
		"aborted":   true,
	})
}

func (d *Dispatcher) response(request protocol.RPCRequest, result interface{}) protocol.RPCResponse {
	return protocol.RPCResponse{
		Version:    protocol.Version,
		Type:       "rpc.response",
		RequestID:  request.RequestID,
		SpaceID:    request.SpaceID,
		SandboxID:  request.SandboxID,
		SessionID:  request.SessionID,
		ToolCallID: request.ToolCallID,
		Timestamp:  nowMS(),
		Result:     result,
	}
}

func (d *Dispatcher) errorResponse(request protocol.RPCRequest, code string, message string) protocol.RPCError {
	return protocol.RPCError{
		Version:    protocol.Version,
		Type:       "rpc.error",
		RequestID:  request.RequestID,
		SpaceID:    request.SpaceID,
		SandboxID:  request.SandboxID,
		SessionID:  request.SessionID,
		ToolCallID: request.ToolCallID,
		Timestamp:  nowMS(),
		Error:      protocol.RPCErrorPayload{Code: code, Message: message, Retryable: false},
	}
}

func (d *Dispatcher) sendStream(request protocol.RPCRequest, event protocol.RPCStreamEvent) error {
	d.mu.Lock()
	sender := d.sender
	d.mu.Unlock()
	if sender == nil {
		return nil
	}

	return sender.SendJSON(protocol.RPCStream{
		Version:    protocol.Version,
		Type:       "rpc.stream",
		RequestID:  request.RequestID,
		SpaceID:    request.SpaceID,
		SandboxID:  request.SandboxID,
		SessionID:  request.SessionID,
		ToolCallID: request.ToolCallID,
		Timestamp:  nowMS(),
		Event:      event,
	})
}
