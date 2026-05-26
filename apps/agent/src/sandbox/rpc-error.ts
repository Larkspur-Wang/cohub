import type { RpcErrorCode, RpcMethod } from "@cohub/protocol/sandbox";

export type SandboxRpcDiagnostics = Record<string, string | number | boolean | null | undefined>;

const INFRA_RPC_ERROR_CODES: ReadonlySet<RpcErrorCode> = new Set([
  "TIMEOUT",
  "PROCESS_SPAWN_FAILED",
  "PROCESS_ABORT_FAILED",
  "IO_ERROR",
  "INTERNAL_ERROR",
]);

function isInfrastructureRpcErrorCode(code: RpcErrorCode): boolean {
  return INFRA_RPC_ERROR_CODES.has(code);
}

export class SandboxRpcError extends Error {

  readonly toolCallError = true;
  readonly infrastructure: boolean;

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
    this.infrastructure = isInfrastructureRpcErrorCode(options.rpcErrorCode);
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
