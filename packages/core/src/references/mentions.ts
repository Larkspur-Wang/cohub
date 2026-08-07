import { parseSpaceSlug, parseUsername } from "@cohub/protocol";

/**
 * Structured parser for Cohub resource mentions embedded in turn text.
 *
 * Mentions are authored as markdown links with a `cohub://` URI, e.g.
 *   @[Core API](cohub://spaces/<spaceId>)
 *   @[Fork](cohub://spaces/<spaceId>/sessions/<sessionId>)
 *   @[Launch](cohub://works/<username>/<spaceSlug>/<workSlug>)
 *
 * Parsing is deterministic against this structured format \u2014 not fuzzy text
 * mining \u2014 so it reliably resolves down to session granularity.
 */

export type ParsedMention =
  | {
      type: "space";
      spaceId: string;
      sessionId?: string;
      label: string;
    }
  | {
      type: "work";
      username: string;
      spaceSlug: string;
      workSlug: string;
      label: string;
    };

const SPACE_MENTION_PATTERN =
  /@\[([^\]\n]+)\]\(cohub:\/\/spaces\/([^/\s)]+)(?:\/sessions\/([^/\s)]+))?\)/g;
const WORK_MENTION_PATTERN =
  /@\[([^\]\n]+)\]\(cohub:\/\/works\/([^/\s)]+)\/([^/\s)]+)\/([^/?#\s)]+)(?:[?#][^\s)]*)?\)/g;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Extract all structured resource mentions from a block of text. */
export const parseMentions = (text: string | null | undefined): ParsedMention[] => {
  if (!text) return [];
  const mentions: Array<ParsedMention & { index: number }> = [];
  for (const match of text.matchAll(SPACE_MENTION_PATTERN)) {
    const label = match[1]?.trim();
    const spaceId = safeDecode(match[2] ?? "").trim();
    const sessionId = safeDecode(match[3] ?? "").trim() || undefined;
    if (!spaceId) continue;
    mentions.push({ type: "space", spaceId, label: label || spaceId, ...(sessionId ? { sessionId } : {}), index: match.index ?? 0 });
  }
  for (const match of text.matchAll(WORK_MENTION_PATTERN)) {
    const label = match[1]?.trim();
    const username = parseUsername(safeDecode(match[2] ?? ""));
    const spaceSlug = parseSpaceSlug(safeDecode(match[3] ?? ""));
    const workSlug = parseSpaceSlug(safeDecode(match[4] ?? ""));
    if (!username || !spaceSlug || !workSlug) continue;
    mentions.push({
      type: "work",
      username,
      spaceSlug,
      workSlug,
      label: label || workSlug,
      index: match.index ?? 0,
    });
  }
  return mentions
    .sort((left, right) => left.index - right.index)
    .map(({ index: _index, ...mention }) => mention);
};
