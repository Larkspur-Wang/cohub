import type { ContentBlock } from "@cohub/protocol/core";

const POSTGRES_UNSUPPORTED_JSON_CHAR = String.fromCharCode(0);
const POSTGRES_UNSUPPORTED_JSON_REPLACEMENT = "\uFFFD";

const sanitizeUtf16Surrogates = (value: string): string => {
  let sanitized = "";

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        sanitized += value.charAt(index) + value.charAt(index + 1);
        index += 1;
      } else {
        sanitized += POSTGRES_UNSUPPORTED_JSON_REPLACEMENT;
      }
      continue;
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      sanitized += POSTGRES_UNSUPPORTED_JSON_REPLACEMENT;
      continue;
    }

    sanitized += value.charAt(index);
  }

  return sanitized;
};

export const sanitizePostgresJsonString = (value: string): string => {
  const withoutUnsupportedChars = value.includes(POSTGRES_UNSUPPORTED_JSON_CHAR)
    ? value.split(POSTGRES_UNSUPPORTED_JSON_CHAR).join("")
    : value;
  return sanitizeUtf16Surrogates(withoutUnsupportedChars);
};

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
