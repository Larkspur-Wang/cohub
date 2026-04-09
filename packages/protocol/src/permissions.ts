/**
 * Permission level for runtime / session resources.
 *
 * - `read`   — anyone can read (including anonymous users)
 * - `write`  — anyone can read and write
 * - `private` — explicitly deny access (no fallback to parent)
 */
export type ResourcePermissionLevel = "read" | "write" | "private";
