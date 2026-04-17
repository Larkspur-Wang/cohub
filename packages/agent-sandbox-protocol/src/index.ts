export const AGENT_SANDBOX_PROTOCOL_VERSION = "1" as const;

export const SANDBOX_STATUSES = [
  "connecting",
  "preparing",
  "ready",
  "busy",
  "error",
] as const;

export type SandboxStatus = (typeof SANDBOX_STATUSES)[number];

export const RPC_METHODS = [
  "workspace.prepare",
  "fs.read",
  "fs.write",
  "process.start",
  "process.abort",
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];

export const RPC_ERROR_CODES = [
  "BAD_REQUEST",
  "UNSUPPORTED_METHOD",
  "NOT_FOUND",
  "TIMEOUT",
  "PROCESS_SPAWN_FAILED",
  "PROCESS_ABORT_FAILED",
  "IO_ERROR",
  "INTERNAL_ERROR",
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export type BaseMessage = {
  version: typeof AGENT_SANDBOX_PROTOCOL_VERSION;
  type: string;
  spaceId: string;
  sandboxId: string;
  timestamp: number;
};

export type RequestScopedMessage = BaseMessage & {
  requestId: string;
  sessionId?: string | null;
  toolCallId?: string | null;
};

export type SandboxCapabilities = {
  workspacePrepare: boolean;
  fsRead: boolean;
  fsWrite: boolean;
  processStart: boolean;
  processAbort: boolean;
};

export type SandboxHello = BaseMessage & {
  type: "sandbox.hello";
  capabilities: SandboxCapabilities;
  metadata?: {
    podName?: string;
    hostname?: string;
    imageVersion?: string;
    startedAt?: string;
  };
};

export type SandboxHelloAck = BaseMessage & {
  type: "sandbox.hello_ack";
  accepted: boolean;
  reason?: string;
};

export type SandboxHeartbeat = BaseMessage & {
  type: "sandbox.heartbeat";
  status: SandboxStatus;
};

export type WorkspacePrepareParams = Record<string, never>;

export type WorkspacePrepareResult = {
  workspaceDir: string;
  prepared: boolean;
  repoCloned: boolean;
  configApplied: boolean;
};

export type FsReadParams = {
  path: string;
  offset?: number;
  limit?: number;
};

export type FsReadResult = {
  path: string;
  content: string;
};

export type FsWriteParams = {
  path: string;
  content: string;
};

export type FsWriteResult = {
  path: string;
  bytesWritten: number;
};

export type ProcessStartParams = {
  command: string;
  timeoutSecs?: number;
  cwd?: string;
};

export type ProcessStartResult = {
  processId: string;
  exitCode: number | null;
};

export type ProcessAbortParams = {
  processId: string;
};

export type ProcessAbortResult = {
  processId: string;
  aborted: boolean;
};

export type RpcRequestMap = {
  "workspace.prepare": {
    params: WorkspacePrepareParams;
    result: WorkspacePrepareResult;
  };
  "fs.read": {
    params: FsReadParams;
    result: FsReadResult;
  };
  "fs.write": {
    params: FsWriteParams;
    result: FsWriteResult;
  };
  "process.start": {
    params: ProcessStartParams;
    result: ProcessStartResult;
  };
  "process.abort": {
    params: ProcessAbortParams;
    result: ProcessAbortResult;
  };
};

export type RpcRequest<M extends RpcMethod = RpcMethod> = RequestScopedMessage & {
  type: "rpc.request";
  method: M;
  params: RpcRequestMap[M]["params"];
};

export type RpcResponse<M extends RpcMethod = RpcMethod> = RequestScopedMessage & {
  type: "rpc.response";
  result: RpcRequestMap[M]["result"];
};

export type RpcError = RequestScopedMessage & {
  type: "rpc.error";
  error: {
    code: RpcErrorCode;
    message: string;
    retryable?: boolean;
  };
};

export type RpcStreamEvent =
  | { type: "started"; processId: string }
  | { type: "stdout"; chunk: string }
  | { type: "stderr"; chunk: string }
  | { type: "exit"; exitCode: number | null };

export type RpcStream = RequestScopedMessage & {
  type: "rpc.stream";
  event: RpcStreamEvent;
};

export type AgentSandboxMessage =
  | SandboxHello
  | SandboxHelloAck
  | SandboxHeartbeat
  | RpcRequest
  | RpcResponse
  | RpcError
  | RpcStream;

export function isRpcMethod(value: string): value is RpcMethod {
  return RPC_METHODS.includes(value as RpcMethod);
}

export function isRpcErrorCode(value: string): value is RpcErrorCode {
  return RPC_ERROR_CODES.includes(value as RpcErrorCode);
}
