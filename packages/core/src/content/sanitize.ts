import type { ContentBlock } from "@cohub/protocol/core";

const POSTGRES_UNSUPPORTED_JSON_CHAR = String.fromCharCode(0);

export const sanitizePostgresJsonString = (value: string): string =>
  value.includes(POSTGRES_UNSUPPORTED_JSON_CHAR)
    ? value.split(POSTGRES_UNSUPPORTED_JSON_CHAR).join("")
    : value;

export const sanitizePostgresJsonValue = <T>(value: T): T => {
  if (typeof value === "string") return sanitizePostgresJsonString(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizePostgresJsonValue(item)) as T;
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      sanitizePostgresJsonValue(nestedValue),
    ]),
  ) as T;
};

export const sanitizeContentBlocksForPostgresJson = (content: ContentBlock[]): ContentBlock[] =>
  sanitizePostgresJsonValue(content);
