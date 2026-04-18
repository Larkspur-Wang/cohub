package rpc

import (
	"encoding/json"
	"fmt"
	"log/slog"
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
	Offset int    `json:"offset"`
	Limit  int    `json:"limit"`
}

type fsWriteParams struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type fsLsParams struct {
	Path  string `json:"path"`
	Limit int    `json:"limit"`
}

type fsFindParams struct {
	Pattern string `json:"pattern"`
	Path    string `json:"path"`
	Limit   int    `json:"limit"`
}

type fsGrepParams struct {
	Pattern    string `json:"pattern"`
	Path       string `json:"path"`
	Glob       string `json:"glob"`
	IgnoreCase bool   `json:"ignoreCase"`
	Literal    bool   `json:"literal"`
	Context    int    `json:"context"`
	Limit      int    `json:"limit"`
}

type processStartParams struct {
	Command     string `json:"command"`
	TimeoutSecs int    `json:"timeoutSecs"`
	CWD         string `json:"cwd"`
}

type processAbortParams struct {
	ProcessID string `json:"processId"`
}

func (d *Dispatcher) handleFSRead(request protocol.RPCRequest) interface{} {
	var params fsReadParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	fullPath := filepath.Join(d.cfg.WorkspaceDir, params.Path)
	content, err := osReadFile(fullPath)
	if err != nil {
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
		"path":    params.Path,
		"content": joinLines(lines[start:end]),
	})
}

func (d *Dispatcher) handleFSWrite(request protocol.RPCRequest) interface{} {
	var params fsWriteParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	fullPath := filepath.Join(d.cfg.WorkspaceDir, params.Path)
	if err := ensureParentDir(fullPath); err != nil {
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}
	if err := osWriteFile(fullPath, []byte(params.Content)); err != nil {
		return d.errorResponse(request, "IO_ERROR", err.Error())
	}

	return d.response(request, map[string]interface{}{
		"path":         params.Path,
		"bytesWritten": len([]byte(params.Content)),
	})
}

func (d *Dispatcher) handleFSLs(request protocol.RPCRequest) interface{} {
	var params fsLsParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	targetPath := d.cfg.WorkspaceDir
	if strings.TrimSpace(params.Path) != "" && params.Path != "." {
		targetPath = filepath.Join(d.cfg.WorkspaceDir, params.Path)
	}

	entries, err := osReadDir(targetPath)
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
		"entries":   results,
		"truncated": truncated,
	})
}

func (d *Dispatcher) handleFSFind(request protocol.RPCRequest) interface{} {
	var params fsFindParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	searchPath := d.cfg.WorkspaceDir
	if strings.TrimSpace(params.Path) != "" && params.Path != "." {
		searchPath = filepath.Clean(params.Path)
	}
	limit := params.Limit
	if limit <= 0 {
		limit = 1000
	}

	cmd := exec.Command("fd", params.Pattern, searchPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
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
		matches = append(matches, line)
	}
	truncated := len(matches) > limit
	if truncated {
		matches = matches[:limit]
	}

	return d.response(request, map[string]interface{}{
		"matches":   matches,
		"truncated": truncated,
	})
}

func (d *Dispatcher) handleFSGrep(request protocol.RPCRequest) interface{} {
	var params fsGrepParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	searchPath := d.cfg.WorkspaceDir
	if strings.TrimSpace(params.Path) != "" && params.Path != "." {
		searchPath = filepath.Clean(params.Path)
	}
	limit := params.Limit
	if limit <= 0 {
		limit = 100
	}

	args := []string{"--line-number", "--color=never", "--hidden"}
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
	args = append(args, params.Pattern, searchPath)

	cmd := exec.Command("rg", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
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
		"lines":     lines,
		"truncated": truncated,
	})
}

func (d *Dispatcher) handleProcessStart(request protocol.RPCRequest) interface{} {
	var params processStartParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.errorResponse(request, "BAD_REQUEST", err.Error())
	}

	cwd := d.cfg.WorkspaceDir
	if params.CWD != "" {
		cwd = filepath.Join(d.cfg.WorkspaceDir, params.CWD)
	}

	processID, stdout, stderr, exitCh, err := d.processManager.Start(params.Command, cwd, params.TimeoutSecs)
	if err != nil {
		return d.errorResponse(request, "PROCESS_SPAWN_FAILED", err.Error())
	}

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
		return d.errorResponse(request, "PROCESS_ABORT_FAILED", err.Error())
	}

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
