/**
 * Structured parser for Cohub space/session mentions embedded in turn text.
 *
 * Mentions are authored as markdown links with a `cohub://` URI, e.g.
 *   @[Core API](cohub://spaces/<spaceId>)
 *   @[Fork](cohub://spaces/<spaceId>/sessions/<sessionId>)
 *
 * Parsing is deterministic against this structured format \u2014 not fuzzy text
 * mining \u2014 so it reliably resolves down to session granularity.
 */

export type ParsedMention = {
  spaceId: string;
  sessionId?: string;
  label: string;
};

const MENTION_PATTERN =
  /@\[([^\]\n]+)\]\(cohub:\/\/spaces\/([^/\s)]+)(?:\/sessions\/([^/\s)]+))?\)/g;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Extract all space/session mentions from a block of text. */
export const parseMentions = (text: string | null | undefined): ParsedMention[] => {
  if (!text) return [];
  const mentions: ParsedMention[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const label = match[1]?.trim();
    const spaceId = safeDecode(match[2] ?? "").trim();
    const sessionId = safeDecode(match[3] ?? "").trim() || undefined;
    if (!spaceId) continue;
    mentions.push({ spaceId, label: label || spaceId, ...(sessionId ? { sessionId } : {}) });
  }
  return mentions;
};
