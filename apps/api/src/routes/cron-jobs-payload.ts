/**
 * Cron payload provenance rule: `payload.auth` is a server-generated
 * authorization reference, never client-editable.
 *
 * A cron PATCH replaces the payload wholesale, so a normal account could
 * otherwise inject a delegated auth pointing at any published app — and the
 * worker would faithfully resolve that app's publisher scopes for it,
 * escalating the editor beyond their own role. The rule: strip whatever the
 * client sent under `auth`, and keep the original payload's auth verbatim —
 * present stays present, absent stays absent.
 */
export function preserveCronPayloadAuth(
  nextPayload: Record<string, unknown>,
  originalPayload: unknown,
): Record<string, unknown> {
  const merged = { ...nextPayload };
  delete merged.auth;
  const originalAuth = (originalPayload as Record<string, unknown> | null | undefined)?.auth;
  if (originalAuth !== undefined) merged.auth = originalAuth;
  return merged;
}
