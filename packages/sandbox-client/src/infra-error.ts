export type SandboxInfraErrorCode = "STALE_MOUNT" | "CRITICAL_MOUNT_IO";

const CRITICAL_MOUNT_PREFIXES = [
  "/workspace",
  "/configs/platform/.agents",
  "/configs/user/.agents",
  "/sessions",
  "/public",
];

const DEFINITIVE_STALE_MOUNT_PATTERNS = [
  "stale nfs file handle",
  "stale file handle",
  "estale",
];

const DEFINITIVE_CRITICAL_IO_PATTERNS = [
  "input/output error",
  "i/o error",
  "transport endpoint is not connected",
];

/**
 * Hard dial failures against a resolved sandbox endpoint. Prefer explicit TCP /
 * host errors over broad transport noise (econnreset, socket hang up) so a
 * transient blip does not recreate the pod.
 *
 * Intentionally excludes "missing endpoint" so legitimate provisioning does
 * not thrash recover.
 */
const ENDPOINT_UNREACHABLE_PATTERNS = [
  "ehostunreach",
  "econnrefused",
  "enetunreach",
  // Node dial failures usually look like "connect ETIMEDOUT <ip>:<port>".
  "connect etimedout",
  "etimedout",
  // Agent attach wait after dial — common when meta still points at a dead pod.
  "timed out waiting for sandbox connection",
] as const;

/** Transient connect failures worth polling after a recover, but not always worth recreate. */
const ENDPOINT_CONNECT_RETRYABLE_PATTERNS = [
  ...ENDPOINT_UNREACHABLE_PATTERNS,
  "missing endpoint",
  "not ready for requests yet",
] as const;

export class SandboxInfrastructureError extends Error {
  constructor(
    readonly code: SandboxInfraErrorCode,
    message: string,
    readonly mountPath?: string,
  ) {
    super(message);
    this.name = "SandboxInfrastructureError";
  }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).toLowerCase();
}

export function isSandboxEndpointUnreachable(error: unknown): boolean {
  const text = errorText(error);
  return ENDPOINT_UNREACHABLE_PATTERNS.some((pattern) => text.includes(pattern));
}

/** After recover, keep polling only for endpoint/readiness races — not auth/logic errors. */
export function isSandboxConnectRetryable(error: unknown): boolean {
  const text = errorText(error);
  return ENDPOINT_CONNECT_RETRYABLE_PATTERNS.some((pattern) => text.includes(pattern));
}

export function classifySandboxInfrastructureError(message: string) {
  const normalized = message.toLowerCase();
  const mountPath = CRITICAL_MOUNT_PREFIXES.find((prefix) => normalized.includes(prefix.toLowerCase()));
  if (!mountPath) return null;

  if (DEFINITIVE_STALE_MOUNT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return new SandboxInfrastructureError("STALE_MOUNT", message, mountPath);
  }

  // ENOENT/ENOTDIR style errors are often ordinary model path mistakes, even
  // under /workspace (e.g. probing node_modules paths that are not installed).
  // Do not escalate them to sandbox recovery without a definitive mount signal.
  if (DEFINITIVE_CRITICAL_IO_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return new SandboxInfrastructureError("CRITICAL_MOUNT_IO", message, mountPath);
  }

  return null;
}
