/**
 * Space sandbox lifecycle status.
 *
 * Internal infrastructure state only.
 * Not intended as a primary user-facing concept.
 */
export type SpaceSandboxStatus =
  | "pending"
  | "provisioning"
  | "ready"
  | "stopped"
  | "error"
  | "terminated";
