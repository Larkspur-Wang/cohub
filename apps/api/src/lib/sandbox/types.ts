export type SpaceSandboxStatus =
  | "pending"
  | "provisioning"
  | "ready"
  | "running"
  | "stopping"
  | "stopped"
  | "error"
  | "terminated";

export type SpaceSandboxRuntimeStatus =
  | "unknown"
  | "starting"
  | "healthy"
  | "degraded"
  | "unhealthy";

export type SpaceSandboxStopReason = "idle" | "manual" | "replaced";
