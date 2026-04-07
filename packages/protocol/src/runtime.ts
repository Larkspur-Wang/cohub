/**
 * Runtime lifecycle status.
 *
 * Lifecycle:
 *   hibernated ─wake()─► starting ─provision─► running ─shutdown─► hibernated
 *                              │                      │
 *                              └── error ◄─── fatal error
 *
 * Terminal: hibernated, error, deleted
 */
export type RuntimeStatus =
  | "starting"
  | "running"
  | "hibernated"
  | "error"
  | "deleted";
