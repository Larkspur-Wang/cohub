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
