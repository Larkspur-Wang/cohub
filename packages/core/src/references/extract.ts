import type { ContentBlock } from "@cohub/protocol/core";
import { parseMentions } from "./mentions.js";
import type { ReferenceInput } from "./types.js";

/** A turn's worth of content needed to extract references from it. */
export type TurnReferenceSource = {
  spaceId: string;
  sessionId: string;
  turnId: string;
  /** The user who authored the turn, for participant references. */
  userUuid?: string | null;
  /** User-authored content (carries @mentions). */
  userContent?: ContentBlock[] | null;
  /** Plain text fallback when structured content is unavailable. */
  userText?: string | null;
  /** Assistant content (carries tool calls). */
  assistantContent?: ContentBlock[] | null;
};

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

const collectText = (content: ContentBlock[] | null | undefined): string => {
  if (!content) return "";
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
};

/**
 * Read a structured `spaceId` / `sessionId` from a tool call's input. Tools that
 * act on other resources carry these as explicit UUID fields, so we resolve
 * cross-resource references structurally rather than by parsing text.
 */
const readToolTarget = (
  input: Record<string, unknown>,
): { spaceId?: string; sessionId?: string } => {
  const spaceId = isUuid(input.spaceId) ? input.spaceId : undefined;
  const sessionId = isUuid(input.sessionId) ? input.sessionId : undefined;
  return { spaceId, sessionId };
};

/**
 * Extract every reference carried by a single turn: the participant, any
 * @mentions in user content, and cross-resource tool calls in assistant
 * content. Merging these into one pass keeps the write path cheap \u2014 a turn is
 * the natural boundary that already holds all three signals.
 *
 * Pure and deterministic: identical input always yields identical output, so it
 * powers both the live double-write and the backfill scan.
 */
export const extractTurnReferences = (turn: TurnReferenceSource): ReferenceInput[] => {
  const references: ReferenceInput[] = [];
  const { spaceId, sessionId, turnId } = turn;

  // Participant: the turn author is an active member of this session.
  const userUuid = turn.userUuid?.trim();
  if (userUuid) {
    references.push({
      kind: "participant",
      sourceType: "user",
      sourceId: userUuid,
      sourceTurnId: turnId,
      targetType: "session",
      targetId: sessionId,
      spaceId,
      sessionId,
    });
  }

  // Mentions: @space / @session links authored in the user's message.
  const mentionText =
    collectText(turn.userContent) || turn.userText || "";
  const seenMentions = new Map<string, ReferenceInput>();
  for (const mention of parseMentions(mentionText)) {
    // Skip self-references to the current session.
    if (mention.sessionId && mention.sessionId === sessionId) continue;
    const targetType: ReferenceInput["targetType"] = mention.sessionId
      ? "session"
      : "space";
    const targetId = mention.sessionId ?? mention.spaceId;
    const key = `${targetType}:${targetId}`;
    const existing = seenMentions.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    const reference: ReferenceInput = {
      kind: "mention",
      sourceType: "session",
      sourceId: sessionId,
      sourceTurnId: turnId,
      targetType,
      targetId,
      spaceId,
      sessionId,
      count: 1,
      meta: {
        label: mention.label,
        ...(mention.sessionId ? { targetSpaceId: mention.spaceId } : {}),
      },
    };
    seenMentions.set(key, reference);
    references.push(reference);
  }

  // Tool calls: cross-resource actions carry structured target ids.
  const seenToolCalls = new Map<string, ReferenceInput>();
  for (const block of turn.assistantContent ?? []) {
    if (block.type !== "tool_use") continue;
    const { spaceId: toolSpaceId, sessionId: toolSessionId } = readToolTarget(block.input);
    // Only record references that point at a *different* resource.
    const targetsOtherSession = toolSessionId && toolSessionId !== sessionId;
    const targetsOtherSpace = toolSpaceId && toolSpaceId !== spaceId;
    if (!targetsOtherSession && !targetsOtherSpace) continue;

    const targetType: ReferenceInput["targetType"] = targetsOtherSession
      ? "session"
      : "space";
    const targetId = (targetsOtherSession ? toolSessionId : toolSpaceId) as string;
    const key = `${targetType}:${targetId}`;
    const existing = seenToolCalls.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    const reference: ReferenceInput = {
      kind: "tool_call",
      sourceType: "session",
      sourceId: sessionId,
      sourceTurnId: turnId,
      targetType,
      targetId,
      spaceId,
      sessionId,
      count: 1,
      meta: {
        tool: block.name,
        ...(targetsOtherSession && toolSpaceId ? { targetSpaceId: toolSpaceId } : {}),
      },
    };
    seenToolCalls.set(key, reference);
    references.push(reference);
  }

  return references;
};
