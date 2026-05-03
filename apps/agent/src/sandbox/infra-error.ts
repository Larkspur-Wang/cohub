export type SandboxInfraErrorCode = "STALE_MOUNT" | "CRITICAL_MOUNT_IO";

const CRITICAL_MOUNT_PREFIXES = [
  "/workspace",
  "/configs/platform/.agents",
  "/configs/user/.agents",
  "/sessions",
  "/public",
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

  if (normalized.includes("stale nfs file handle") || normalized.includes("stale file handle") || normalized.includes("estale")) {
    return new SandboxInfrastructureError("STALE_MOUNT", message, mountPath);
  }
  if (
    normalized.includes("input/output error") ||
    normalized.includes("transport endpoint is not connected") ||
    normalized.includes("not a directory")
  ) {
    return new SandboxInfrastructureError("CRITICAL_MOUNT_IO", message, mountPath);
  }
  return null;
}
