import type { RpcErrorCode, RpcMethod } from "@cohub/protocol/sandbox";

export type SandboxRpcDiagnostics = Record<string, string | number | boolean | null | undefined>;

export const SANDBOX_NOT_READY_MESSAGE = "Sandbox is not ready.";
export const SANDBOX_CONNECTION_LOST_MESSAGE = "Sandbox connection lost.";

const CONNECTION_NOT_READY_PATTERNS = [
  "connect_failed",
  "missing podip",
  "not ready for requests",
  "has not been started",
  "timed out waiting for sandbox connection",
  "closed before attach",
  "websocket closed before attach",
] as const;

const CONNECTION_LOST_PATTERNS = [
  "connection closed",
  "connection replaced",
  "ehostunreach",
  "econnrefused",
  "econnreset",
  "etimedout",
  "socket hang up",
  "websocket is not open",
] as const;

function includesAny(value: string, patterns: readonly string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

export type SandboxRpcFailurePresentation = {
  kind: "connect_failed" | "connection_lost" | "rpc_error";
  message: string;
  infrastructure: boolean;
};

export class SandboxRpcError extends Error {
  readonly toolCallError = true;

  constructor(
    message: string,
    readonly options: {
      method: RpcMethod | string;
      rpcErrorCode: RpcErrorCode;
      retryable: boolean;
      transportReason?: string;
      diagnostics?: SandboxRpcDiagnostics;
    },
  ) {
    super(message);
    this.name = "SandboxRpcError";
  }

  get method() {
    return this.options.method;
  }

  get rpcErrorCode() {
    return this.options.rpcErrorCode;
  }

  get retryable() {
    return this.options.retryable;
  }

  get transportReason() {
    return this.options.transportReason;
  }

  get diagnostics() {
    return this.options.diagnostics;
  }
}

export function isSandboxRpcError(error: unknown): error is SandboxRpcError {
  return error instanceof SandboxRpcError;
}

export function getSandboxRpcFailurePresentation(error: SandboxRpcError): SandboxRpcFailurePresentation {
  const text = `${error.transportReason ?? ""} ${error.message}`.toLowerCase();

  if (error.message === SANDBOX_NOT_READY_MESSAGE || includesAny(text, CONNECTION_NOT_READY_PATTERNS)) {
    return {
      kind: "connect_failed",
      message: SANDBOX_NOT_READY_MESSAGE,
      infrastructure: true,
    };
  }

  if (error.message === SANDBOX_CONNECTION_LOST_MESSAGE || includesAny(text, CONNECTION_LOST_PATTERNS)) {
    return {
      kind: "connection_lost",
      message: SANDBOX_CONNECTION_LOST_MESSAGE,
      infrastructure: true,
    };
  }

  return {
    kind: "rpc_error",
    message: error.message,
    infrastructure: false,
  };
}
