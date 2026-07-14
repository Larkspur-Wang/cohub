/** Read a trimmed non-empty env value. */
export function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/**
 * Merge sandbox provenance into meta under `source`.
 * Prefer explicit values; fall back to COHUB_* env vars from the agent/tool runtime.
 */
export function mergeSourceMeta(
  meta: Record<string, unknown> | undefined,
  source?: {
    spaceId?: string;
    sessionId?: string;
    turnId?: string;
    toolCallId?: string;
  },
): Record<string, unknown> | undefined {
  const spaceId = source?.spaceId?.trim() || envValue("COHUB_SPACE_ID");
  const sessionId = source?.sessionId?.trim() || envValue("COHUB_SESSION_ID");
  const turnId = source?.turnId?.trim() || envValue("COHUB_TURN_ID");
  const toolCallId = source?.toolCallId?.trim() || envValue("COHUB_TOOL_CALL_ID");
  if (!spaceId && !sessionId && !turnId && !toolCallId) return meta;

  const existingSource = meta?.source;
  const nextSource = existingSource && typeof existingSource === "object" && !Array.isArray(existingSource)
    ? { ...(existingSource as Record<string, unknown>) }
    : {};
  if (spaceId) nextSource.spaceId = spaceId;
  if (sessionId) nextSource.sessionId = sessionId;
  if (turnId) nextSource.turnId = turnId;
  if (toolCallId) nextSource.toolCallId = toolCallId;

  return {
    ...(meta ?? {}),
    source: nextSource,
  };
}
