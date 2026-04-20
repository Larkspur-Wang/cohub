package protocol

import "encoding/json"

const Version = "1"

type SandboxFilesystemRoot struct {
	Path     string `json:"path"`
	Writable bool   `json:"writable"`
	Label    string `json:"label,omitempty"`
}

type SandboxFilesystem struct {
	Roots      []SandboxFilesystemRoot `json:"roots"`
	DefaultCwd string                  `json:"defaultCwd"`
	Mode       string                  `json:"mode,omitempty"`
	Notes      []string                `json:"notes,omitempty"`
}

type SandboxCapabilities struct {
	FSRead       bool `json:"fsRead"`
	FSWrite      bool `json:"fsWrite"`
	FSStat       bool `json:"fsStat"`
	FSLs         bool `json:"fsLs"`
	FSFind       bool `json:"fsFind"`
	FSGrep       bool `json:"fsGrep"`
	ProcessStart bool `json:"processStart"`
	ProcessAbort bool `json:"processAbort"`
}

type SandboxMetadata struct {
	PodName       string `json:"podName,omitempty"`
	Hostname      string `json:"hostname,omitempty"`
	ImageVersion  string `json:"imageVersion,omitempty"`
	StartedAt     string `json:"startedAt,omitempty"`
	PrepareStatus string `json:"prepareStatus,omitempty"`
	PrepareError  string `json:"prepareError,omitempty"`
}

type SandboxHello struct {
	Version      string              `json:"version"`
	Type         string              `json:"type"`
	SpaceID      string              `json:"spaceId"`
	SandboxID    string              `json:"sandboxId"`
	Timestamp    int64               `json:"timestamp"`
	Capabilities SandboxCapabilities `json:"capabilities"`
	Filesystem   *SandboxFilesystem  `json:"filesystem,omitempty"`
	Metadata     *SandboxMetadata    `json:"metadata,omitempty"`
}

type SandboxHelloAck struct {
	Version   string `json:"version"`
	Type      string `json:"type"`
	SpaceID   string `json:"spaceId"`
	SandboxID string `json:"sandboxId"`
	Timestamp int64  `json:"timestamp"`
	Accepted  bool   `json:"accepted"`
	Reason    string `json:"reason,omitempty"`
}

type SandboxHeartbeat struct {
	Version   string `json:"version"`
	Type      string `json:"type"`
	SpaceID   string `json:"spaceId"`
	SandboxID string `json:"sandboxId"`
	Timestamp int64  `json:"timestamp"`
	Status    string `json:"status"`
}

type RPCRequest struct {
	Version    string          `json:"version"`
	Type       string          `json:"type"`
	RequestID  string          `json:"requestId"`
	SpaceID    string          `json:"spaceId"`
	SandboxID  string          `json:"sandboxId"`
	SessionID  *string         `json:"sessionId,omitempty"`
	ToolCallID *string         `json:"toolCallId,omitempty"`
	Timestamp  int64           `json:"timestamp"`
	Method     string          `json:"method"`
	Params     json.RawMessage `json:"params"`
}

type RPCResponse struct {
	Version    string      `json:"version"`
	Type       string      `json:"type"`
	RequestID  string      `json:"requestId"`
	SpaceID    string      `json:"spaceId"`
	SandboxID  string      `json:"sandboxId"`
	SessionID  *string     `json:"sessionId,omitempty"`
	ToolCallID *string     `json:"toolCallId,omitempty"`
	Timestamp  int64       `json:"timestamp"`
	Result     interface{} `json:"result"`
}

type RPCErrorPayload struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type RPCError struct {
	Version    string          `json:"version"`
	Type       string          `json:"type"`
	RequestID  string          `json:"requestId"`
	SpaceID    string          `json:"spaceId"`
	SandboxID  string          `json:"sandboxId"`
	SessionID  *string         `json:"sessionId,omitempty"`
	ToolCallID *string         `json:"toolCallId,omitempty"`
	Timestamp  int64           `json:"timestamp"`
	Error      RPCErrorPayload `json:"error"`
}

type RPCStreamEvent struct {
	Type      string `json:"type"`
	ProcessID string `json:"processId,omitempty"`
	Chunk     string `json:"chunk,omitempty"`
	ExitCode  *int   `json:"exitCode,omitempty"`
}

type RPCStream struct {
	Version    string         `json:"version"`
	Type       string         `json:"type"`
	RequestID  string         `json:"requestId"`
	SpaceID    string         `json:"spaceId"`
	SandboxID  string         `json:"sandboxId"`
	SessionID  *string        `json:"sessionId,omitempty"`
	ToolCallID *string        `json:"toolCallId,omitempty"`
	Timestamp  int64          `json:"timestamp"`
	Event      RPCStreamEvent `json:"event"`
}

type IncomingEnvelope struct {
	Type string `json:"type"`
}
