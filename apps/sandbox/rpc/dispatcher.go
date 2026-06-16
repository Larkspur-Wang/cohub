package rpc

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/google/uuid"

	"github.com/cohub/apps/sandbox/env"
	"github.com/cohub/apps/sandbox/process"
	"github.com/cohub/apps/sandbox/protocol"
)

type IdentityRouter interface {
	SendToIdentity(identity string, v interface{}) error
}

type Dispatcher struct {
	cfg            env.Config
	processManager *process.Manager
	logger         *slog.Logger
	router         IdentityRouter
	opSeq          int64
	mu             sync.Mutex
}

func NewDispatcher(cfg env.Config, processManager *process.Manager, logger *slog.Logger) *Dispatcher {
	return &Dispatcher{cfg: cfg, processManager: processManager, logger: logger}
}

func (d *Dispatcher) SetRouter(router IdentityRouter) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.router = router
}

func (d *Dispatcher) nextSeq() int64 {
	return atomic.AddInt64(&d.opSeq, 1)
}

func (d *Dispatcher) Handle(request protocol.RPCRequest, ownerIdentity string) (protocol.RPCAccepted, interface{}) {
	accepted := protocol.RPCAccepted{
		RequestScopedMessage: protocol.RequestScopedMessage{
			BaseMessage: protocol.BaseMessage{
				Version:   protocol.Version,
				Type:      "rpc.accepted",
				SpaceID:   request.SpaceID,
				SandboxID: request.SandboxID,
				Timestamp: nowMS(),
			},
			RequestID:  request.RequestID,
			SessionID:  request.SessionID,
			ToolCallID: request.ToolCallID,
		},
		OpID: uuid.NewString(),
	}

	switch request.Method {
	case "fs.read":
		return accepted, d.complete(request, accepted.OpID, d.handleFSRead(request))
	case "fs.write":
		return accepted, d.complete(request, accepted.OpID, d.handleFSWrite(request))
	case "fs.stat":
		return accepted, d.complete(request, accepted.OpID, d.handleFSStat(request))
	case "fs.ls":
		return accepted, d.complete(request, accepted.OpID, d.handleFSLs(request))
	case "fs.find":
		return accepted, d.complete(request, accepted.OpID, d.handleFSFind(request))
	case "fs.grep":
		return accepted, d.complete(request, accepted.OpID, d.handleFSGrep(request))
	case "process.start":
		return accepted, d.handleProcessStart(request, accepted.OpID, ownerIdentity)
	case "process.abort":
		return accepted, d.complete(request, accepted.OpID, d.handleProcessAbort(request))
	default:
		return accepted, d.failed(request, accepted.OpID, "UNSUPPORTED_METHOD", fmt.Sprintf("unsupported method: %s", request.Method))
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

const (
	processStartMaxArgvItems      = 256
	processStartMaxArgvItemBytes  = 8 * 1024
	processStartMaxArgvTotalBytes = 64 * 1024
)

type processStartParams struct {
	Command     string            `json:"command"`
	Argv        []string          `json:"argv"`
	TimeoutSecs int               `json:"timeoutSecs"`
	CWD         string            `json:"cwd"`
	Env         map[string]string `json:"env"`
}

type processAbortParams struct {
	ProcessID string `json:"processId"`
}

func (d *Dispatcher) resolvePathForRequest(request protocol.RPCRequest, rawPath string, cwd string) (resolvedSandboxPath, interface{}, bool) {
	resolved, err := resolveSandboxPath(d.cfg, rawPath, cwd)
	if err != nil {
		return resolvedSandboxPath{}, d.failed(request, "", "INVALID_PATH", err.Error()), false
	}
	return resolved, nil, true
}

func (d *Dispatcher) handleFSRead(request protocol.RPCRequest) interface{} {
	var params fsReadParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	if params.Binary {
		rawBytes, err := osReadFileBytes(resolved.path)
		if err != nil {
			if os.IsNotExist(err) {
				return d.failed(request, "", "NOT_FOUND", err.Error())
			}
			return d.failed(request, "", "IO_ERROR", err.Error())
		}
		mimeType := detectMimeType(resolved.path, rawBytes)
		return map[string]interface{}{
			"path":          resolved.path,
			"content":       "",
			"contentBase64": fileToBase64(rawBytes),
			"mimeType":      mimeType,
		}
	}

	content, err := osReadFile(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return d.failed(request, "", "NOT_FOUND", err.Error())
		}
		return d.failed(request, "", "IO_ERROR", err.Error())
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

	return map[string]interface{}{
		"path":    resolved.path,
		"content": joinLines(lines[start:end]),
	}
}

func (d *Dispatcher) handleFSWrite(request protocol.RPCRequest) interface{} {
	var params fsWriteParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}
	if isReadOnlyPath(d.cfg, resolved.path) {
		return d.failed(request, "", "READ_ONLY_FILESYSTEM", fmt.Sprintf("path is read-only: %s", resolved.path))
	}
	if info, err := os.Stat(resolved.path); err == nil && info.IsDir() {
		return d.failed(request, "", "NOT_DIRECTORY", fmt.Sprintf("cannot write to a directory: %s", resolved.path))
	}

	if err := ensureParentDir(resolved.path); err != nil {
		return d.failed(request, "", "IO_ERROR", err.Error())
	}
	if err := osWriteFile(resolved.path, []byte(params.Content)); err != nil {
		return d.failed(request, "", "IO_ERROR", err.Error())
	}

	return map[string]interface{}{
		"path":         resolved.path,
		"bytesWritten": len([]byte(params.Content)),
	}
}

type fsStatParams struct {
	Path string `json:"path"`
	CWD  string `json:"cwd"`
}

func (d *Dispatcher) handleFSStat(request protocol.RPCRequest) interface{} {
	var params fsStatParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	info, err := os.Stat(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]interface{}{
				"path":        resolved.path,
				"exists":      false,
				"isDirectory": false,
			}
		}
		return d.failed(request, "", "IO_ERROR", err.Error())
	}

	return map[string]interface{}{
		"path":        resolved.path,
		"exists":      true,
		"isDirectory": info.IsDir(),
	}
}

func (d *Dispatcher) handleFSLs(request protocol.RPCRequest) interface{} {
	var params fsLsParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	info, err := os.Stat(resolved.path)
	if err != nil {
		if os.IsNotExist(err) {
			return d.failed(request, "", "NOT_FOUND", err.Error())
		}
		return d.failed(request, "", "IO_ERROR", err.Error())
	}
	if !info.IsDir() {
		return d.failed(request, "", "NOT_DIRECTORY", fmt.Sprintf("not a directory: %s", resolved.path))
	}

	entries, err := osReadDir(resolved.path)
	if err != nil {
		return d.failed(request, "", "IO_ERROR", err.Error())
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

	return map[string]interface{}{
		"path":      resolved.path,
		"entries":   results,
		"truncated": truncated,
	}
}

func (d *Dispatcher) handleFSFind(request protocol.RPCRequest) interface{} {
	var params fsFindParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
	}

	resolved, errResponse, ok := d.resolvePathForRequest(request, params.Path, params.CWD)
	if !ok {
		return errResponse
	}

	limit := params.Limit
	if limit <= 0 {
		limit = 1000
	}

	args := []string{"--color=never"}
	switch params.Mode {
	case "glob":
		args = append(args, "--glob")
	case "fixed-strings":
		args = append(args, "--fixed-strings")
	}
	if params.Hidden {
		args = append(args, "--hidden")
	}
	if !params.RequireGit {
		args = append(args, "--no-require-git")
	}
	if params.IgnoreVcs {
		args = append(args, "--no-ignore-vcs")
	}
	if params.FullPath {
		args = append(args, "--full-path")
	}
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
			return d.failed(request, "", "INTERNAL_ERROR", "fd is not installed in sandbox")
		}
		stderr := strings.TrimSpace(string(output))
		if stderr == "" {
			stderr = err.Error()
		}
		return d.failed(request, "", "IO_ERROR", stderr)
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

	return map[string]interface{}{
		"path":      resolved.path,
		"matches":   matches,
		"truncated": truncated,
	}
}

func (d *Dispatcher) handleFSGrep(request protocol.RPCRequest) interface{} {
	var params fsGrepParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
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
	if !params.RequireGit {
		args = append(args, "--no-require-git")
	}
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
			return d.failed(request, "", "INTERNAL_ERROR", "rg is not installed in sandbox")
		}

		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			outputText := strings.TrimSpace(string(output))
			if outputText == "" {
				return map[string]interface{}{
					"path":      resolved.path,
					"lines":     []string{},
					"truncated": false,
				}
			}
			if params.JSON {
				lines := make([]string, 0)
				for _, line := range strings.Split(outputText, "\n") {
					trimmed := strings.TrimSpace(line)
					if trimmed == "" {
						continue
					}
					lines = append(lines, trimmed)
				}
				onlySummary := true
				for _, line := range lines {
					var payload struct {
						Type string `json:"type"`
					}
					if json.Unmarshal([]byte(line), &payload) != nil || payload.Type != "summary" {
						onlySummary = false
						break
					}
				}
				if onlySummary && len(lines) > 0 {
					return map[string]interface{}{
						"path":      resolved.path,
						"lines":     []string{},
						"truncated": false,
					}
				}
			}
		}

		stderr := strings.TrimSpace(string(output))
		if stderr == "" {
			stderr = err.Error()
		}
		if !strings.Contains(stderr, "No files were searched") && !strings.Contains(stderr, "No such file or directory") {
			return d.failed(request, "", "IO_ERROR", stderr)
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

	return map[string]interface{}{
		"path":      resolved.path,
		"lines":     lines,
		"truncated": truncated,
	}
}

func validateProcessArgv(argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("argv must be non-empty")
	}
	if len(argv) > processStartMaxArgvItems {
		return fmt.Errorf("argv has too many items: %d > %d", len(argv), processStartMaxArgvItems)
	}
	totalBytes := 0
	for i, item := range argv {
		itemBytes := len([]byte(item))
		if itemBytes == 0 && i == 0 {
			return fmt.Errorf("argv[0] must be a non-empty executable")
		}
		if itemBytes > processStartMaxArgvItemBytes {
			return fmt.Errorf("argv[%d] is too large: %d > %d bytes", i, itemBytes, processStartMaxArgvItemBytes)
		}
		totalBytes += itemBytes
		if totalBytes > processStartMaxArgvTotalBytes {
			return fmt.Errorf("argv is too large: %d > %d bytes", totalBytes, processStartMaxArgvTotalBytes)
		}
	}
	return nil
}

func processArgvSummary(argv []string, limit int) string {
	if limit <= 0 {
		return ""
	}
	var b strings.Builder
	for i, item := range argv {
		if i > 0 {
			if b.Len()+1 > limit {
				return b.String()
			}
			b.WriteByte(' ')
		}
		remaining := limit - b.Len()
		if remaining <= 0 {
			break
		}
		if len(item) > remaining {
			b.WriteString(item[:remaining])
			break
		}
		b.WriteString(item)
	}
	return b.String()
}

func (d *Dispatcher) handleProcessStart(request protocol.RPCRequest, opID string, ownerIdentity string) interface{} {
	var params processStartParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, opID, "BAD_REQUEST", err.Error())
	}

	commandProvided := strings.TrimSpace(params.Command) != ""
	argvProvided := len(params.Argv) > 0
	if commandProvided == argvProvided {
		return d.failed(request, opID, "BAD_REQUEST", "exactly one of command or argv must be provided")
	}
	if argvProvided {
		if err := validateProcessArgv(params.Argv); err != nil {
			return d.failed(request, opID, "BAD_REQUEST", err.Error())
		}
	}

	cmdSummary := strings.TrimSpace(params.Command)
	if argvProvided {
		cmdSummary = processArgvSummary(params.Argv, 80)
	}
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
			return d.failed(request, opID, "NOT_FOUND", err.Error())
		}
		return d.failed(request, opID, "IO_ERROR", err.Error())
	}
	if !info.IsDir() {
		return d.failed(request, opID, "NOT_DIRECTORY", fmt.Sprintf("not a directory: %s", resolved.path))
	}

	processID, stdout, stderr, exitCh, err := d.processManager.StartWithOptions(ownerIdentity, process.StartOptions{
		Command:     params.Command,
		Argv:        params.Argv,
		CWD:         resolved.path,
		TimeoutSecs: params.TimeoutSecs,
		Env:         params.Env,
	})
	if err != nil {
		d.logger.Error("process:start failed", slog.String("cmd", cmdSummary), slog.String("error", err.Error()))
		return d.failed(request, opID, "PROCESS_SPAWN_FAILED", err.Error())
	}
	d.logger.Info("process:start", slog.String("processId", processID), slog.String("ownerIdentity", ownerIdentity), slog.String("cmd", cmdSummary), slog.String("cwd", resolved.path))

	_ = d.sendEventToIdentity(ownerIdentity, d.event(request, opID, protocol.RPCEventPayload{Type: "started", ProcessID: processID}))

	go func() {
		_ = process.StreamChunks(stdout, func(chunk string) {
			_ = d.sendEventToIdentity(ownerIdentity, d.event(request, opID, protocol.RPCEventPayload{Type: "stdout", Chunk: chunk}))
		})
	}()
	go func() {
		_ = process.StreamChunks(stderr, func(chunk string) {
			_ = d.sendEventToIdentity(ownerIdentity, d.event(request, opID, protocol.RPCEventPayload{Type: "stderr", Chunk: chunk}))
		})
	}()
	go func() {
		exitInfo := <-exitCh
		termination := processTermination(exitInfo)
		codeStr := "unknown"
		if exitInfo.ExitCode != nil {
			codeStr = fmt.Sprintf("%d", *exitInfo.ExitCode)
		}
		d.logger.Info("process:exit", slog.String("processId", processID), slog.String("ownerIdentity", ownerIdentity), slog.String("exitCode", codeStr), slog.String("reason", termination.Reason), slog.String("cmd", cmdSummary))
		_ = d.sendEventToIdentity(ownerIdentity, d.event(request, opID, protocol.RPCEventPayload{Type: "exit", ExitCode: exitInfo.ExitCode, Termination: termination}))
		_ = d.sendEventToIdentity(ownerIdentity, d.complete(request, opID, map[string]interface{}{
			"processId":   processID,
			"exitCode":    exitInfo.ExitCode,
			"termination": termination,
		}))
	}()

	return nil
}

func processTermination(exitInfo process.ExitInfo) *protocol.ProcessTermination {
	reason := exitInfo.Reason
	message := ""
	switch reason {
	case "timeout":
		reason = "timed_out"
		message = fmt.Sprintf("Command timed out after %d seconds.", exitInfo.TimeoutSecs)
	case "abort", "identity_disconnect":
		reason = "aborted"
		message = "Command aborted."
	case "exited", "":
		reason = "exited"
	default:
		reason = "aborted"
		message = "Command aborted."
	}

	termination := &protocol.ProcessTermination{
		Reason:   reason,
		ExitCode: exitInfo.ExitCode,
		Message:  message,
	}
	if reason == "timed_out" && exitInfo.TimeoutSecs > 0 {
		termination.TimeoutSecs = exitInfo.TimeoutSecs
	}
	return termination
}

func (d *Dispatcher) handleProcessAbort(request protocol.RPCRequest) interface{} {
	var params processAbortParams
	if err := json.Unmarshal(request.Params, &params); err != nil {
		return d.failed(request, "", "BAD_REQUEST", err.Error())
	}

	if err := d.processManager.Abort(params.ProcessID); err != nil {
		d.logger.Warn("process:abort failed", slog.String("processId", params.ProcessID), slog.String("error", err.Error()))
		return d.failed(request, "", "PROCESS_ABORT_FAILED", err.Error())
	}
	d.logger.Info("process:abort", slog.String("processId", params.ProcessID))

	return map[string]interface{}{
		"processId": params.ProcessID,
		"aborted":   true,
	}
}

func (d *Dispatcher) complete(request protocol.RPCRequest, opID string, result interface{}) interface{} {
	// If a handler already produced a terminal failure payload, enrich and forward it.
	// Note: the type assertion yields a value copy; we intentionally mutate that copy
	// and return it as the finalized failed payload.
	if failed, ok := result.(protocol.RPCFailed); ok {
		if opID != "" && failed.OpID == "" {
			failed.OpID = opID
		}
		if failed.Seq == 0 {
			failed.Seq = d.nextSeq()
		}
		return failed
	}
	return protocol.RPCCompleted{
		OperationScopedMessage: protocol.OperationScopedMessage{
			BaseMessage: protocol.BaseMessage{
				Version:   protocol.Version,
				Type:      "rpc.completed",
				SpaceID:   request.SpaceID,
				SandboxID: request.SandboxID,
				Timestamp: nowMS(),
			},
			OpID:       opID,
			RequestID:  request.RequestID,
			Seq:        d.nextSeq(),
			SessionID:  request.SessionID,
			ToolCallID: request.ToolCallID,
		},
		Result: result,
	}
}

func (d *Dispatcher) failed(request protocol.RPCRequest, opID string, code string, message string) protocol.RPCFailed {
	return protocol.RPCFailed{
		OperationScopedMessage: protocol.OperationScopedMessage{
			BaseMessage: protocol.BaseMessage{
				Version:   protocol.Version,
				Type:      "rpc.failed",
				SpaceID:   request.SpaceID,
				SandboxID: request.SandboxID,
				Timestamp: nowMS(),
			},
			OpID:       opID,
			RequestID:  request.RequestID,
			Seq:        d.nextSeq(),
			SessionID:  request.SessionID,
			ToolCallID: request.ToolCallID,
		},
		Error: protocol.RPCErrorPayload{Code: code, Message: message, Retryable: false},
	}
}

func (d *Dispatcher) event(request protocol.RPCRequest, opID string, event protocol.RPCEventPayload) protocol.RPCEvent {
	return protocol.RPCEvent{
		OperationScopedMessage: protocol.OperationScopedMessage{
			BaseMessage: protocol.BaseMessage{
				Version:   protocol.Version,
				Type:      "rpc.event",
				SpaceID:   request.SpaceID,
				SandboxID: request.SandboxID,
				Timestamp: nowMS(),
			},
			OpID:       opID,
			RequestID:  request.RequestID,
			Seq:        d.nextSeq(),
			SessionID:  request.SessionID,
			ToolCallID: request.ToolCallID,
		},
		Event: event,
	}
}

func (d *Dispatcher) sendEventToIdentity(identity string, payload interface{}) error {
	d.mu.Lock()
	router := d.router
	d.mu.Unlock()
	if router == nil {
		return nil
	}
	return router.SendToIdentity(identity, payload)
}
