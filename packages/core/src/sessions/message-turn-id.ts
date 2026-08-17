import { isUuid } from "@cohub/protocol/identifiers";

export function resolveMessageTurnId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>).turnId;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return isUuid(normalized) ? normalized.toLowerCase() : null;
}
