import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { Hono } from "hono";
import { hasPermission } from "../permissions.js";
import { getOptionalAuth, useAuth, requireValidId } from "../lib/middleware.js";
import {
  getSpaceById,
  getSpaceSessionById,
  getSessionMessageById,
  listSessionMessages,
  enqueueSpacePrompt,
  SandboxNotReadyError,
  updateSpaceSessionInfo,
  summarizeMessageForHistory,
  markMessageAsFull,
} from "../space-sessions.js";
import { createSignedTurnUrls, createSessionTurn, failSessionTurn, getSessionTurnById, getSessionTurnSequenceById, listSessionTurnIndex, listSessionTurns, listSessionTurnWindow } from "../session-turns.js";
import { expandPromptTemplate } from "../prompt-templates.js";

const router = new Hono();

router.get("/:id", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const space = await getSpaceById(session.spaceId);
  if (!space) return c.json({ message: "session not found" }, 404);

  return c.json({ space, session, user });
});

// ── PATCH /api/sessions/:id (rename) ─────────────────────────────────────────

router.patch("/:id", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.edit", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const body = await c.req.json<{ title?: string }>().catch(() => null);
  const title = body?.title ?? null;
  const newTitle = title?.trim() || null;

  if (newTitle === session.title) return c.json({ session });

  await updateSpaceSessionInfo({ spaceId: session.spaceId, sessionId: session.id, title: newTitle });

  const refreshed = await getSpaceSessionById(sessionId);
  return c.json({ session: refreshed ?? session });
});

router.get("/:id/turns", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const cursorParam = c.req.query("cursor");
  let cursor = cursorParam ? Number(cursorParam) : undefined;
  if (cursor !== undefined && (!Number.isFinite(cursor) || cursor < 1)) return c.json({ message: "invalid cursor" }, 400);
  cursor = cursor === undefined ? undefined : Math.floor(cursor);
  const rawLimit = Number(c.req.query("limit") ?? 30);
  if (!Number.isFinite(rawLimit)) return c.json({ message: "invalid limit" }, 400);
  const pageLimit = Math.min(Math.max(Math.floor(rawLimit), 1), 100);
  const directionParam = c.req.query("direction") ?? "older";
  if (directionParam !== "older" && directionParam !== "newer") return c.json({ message: "invalid direction" }, 400);
  const direction = directionParam;
  const fetchLimit = Math.min(pageLimit + 1, 101);
  const rows = await listSessionTurns(session.id, { cursor, limit: fetchLimit, direction });
  const hasMore = rows.length > pageLimit;
  const turns = hasMore ? (direction === "newer" ? rows.slice(0, pageLimit) : rows.slice(1)) : rows;
  return c.json({
    session,
    turns,
    hasMore,
    nextCursor: turns.length > 0
      ? direction === "older"
        ? turns[0]?.sequence
        : turns[turns.length - 1]?.sequence
      : undefined,
  });
});

router.get("/:id/turns/index", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const cursorParam = c.req.query("cursor");
  let cursor = cursorParam ? Number(cursorParam) : undefined;
  if (cursor !== undefined && (!Number.isFinite(cursor) || cursor < 1)) return c.json({ message: "invalid cursor" }, 400);
  cursor = cursor === undefined ? undefined : Math.floor(cursor);
  const rawLimit = Number(c.req.query("limit") ?? 200);
  if (!Number.isFinite(rawLimit)) return c.json({ message: "invalid limit" }, 400);
  const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 500);
  const result = await listSessionTurnIndex(session.id, { cursor, limit });
  return c.json({ session, ...result });
});

router.get("/:id/turns/window", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const turnId = c.req.query("turnId");
  let sequence = c.req.query("sequence") ? Number(c.req.query("sequence")) : undefined;
  if (turnId) {
    if (!requireValidId(turnId)) return c.json({ message: "invalid turn id" }, 400);
    const found = await getSessionTurnSequenceById(session.id, turnId);
    if (found == null) return c.json({ message: "turn not found" }, 404);
    sequence = found;
  }
  if (sequence === undefined || !Number.isFinite(sequence) || sequence < 1) return c.json({ message: "invalid sequence" }, 400);
  const before = Number(c.req.query("before") ?? 10);
  const after = Number(c.req.query("after") ?? 20);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return c.json({ message: "invalid window" }, 400);
  const result = await listSessionTurnWindow(session.id, { sequence: Math.floor(sequence), before, after });
  if (!result) return c.json({ message: "turn not found" }, 404);
  return c.json({ session, ...result });
});

router.get("/:id/turns/:turnId", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  const turnId = c.req.param("turnId");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  if (!turnId || !requireValidId(turnId)) return c.json({ message: "turn not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const turn = await getSessionTurnById(session.id, turnId);
  if (!turn) return c.json({ message: "turn not found" }, 404);
  return c.json({ session, turn });
});

router.post("/:id/turns/:turnId/signed-urls", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  const turnId = c.req.param("turnId");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  if (!turnId || !requireValidId(turnId)) return c.json({ message: "turn not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }
  const turn = await getSessionTurnById(session.id, turnId);
  if (!turn) return c.json({ message: "turn not found" }, 404);

  const body = await c.req.json<{ objectKeys?: string[] }>().catch(() => null);
  const objectKeys = Array.isArray(body?.objectKeys) ? body.objectKeys.filter((key): key is string => typeof key === "string") : [];
  if (objectKeys.length === 0 || objectKeys.length > 50) return c.json({ message: "objectKeys is required" }, 400);
  let urls: Awaited<ReturnType<typeof createSignedTurnUrls>>;
  try {
    urls = await createSignedTurnUrls({ spaceId: session.spaceId, sessionId: session.id, turnId, objectKeys });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "invalid object key" }, 400);
  }
  return c.json({ urls });
});

router.get("/:id/messages", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const cursorParam = c.req.query("cursor");
  const cursor = cursorParam ? Number(cursorParam) : undefined;
  const pageLimit = Math.min(Number(c.req.query("limit") ?? 30), 100) || 30;
  const direction = (c.req.query("direction") as "older" | "newer" | undefined) ?? "older";
  const detail = c.req.query("detail") === "full" ? "full" : "summary";

  // Always fetch +1 sentinel to correctly detect hasMore.
  // The sentinel position depends on the query direction:
  //   - Initial load (no cursor) or "older": sentinel is the oldest (index 0)
  //   - "newer": sentinel is the newest (last element)
  const fetchLimit = Math.min(pageLimit + 1, 101);

  const rows = await listSessionMessages(session.id, {
    cursor,
    limit: fetchLimit,
    direction,
  });
  const hasMore = rows.length > pageLimit;
  const pageMessages = hasMore
    ? (direction === "newer" ? rows.slice(0, -1) : rows.slice(1))
    : rows;
  const messages = detail === "full"
    ? pageMessages.map(markMessageAsFull)
    : pageMessages.map((message) => summarizeMessageForHistory(message));

  return c.json({
    session,
    messages,
    hasMore,
    nextCursor: pageMessages.length > 0
      ? direction === "older"
        ? (pageMessages[0]?.sequence ?? 0) - 1
        : (pageMessages[pageMessages.length - 1]?.sequence ?? 0)
      : undefined,
  });
});

router.get("/:id/messages/:messageId", async (c) => {
  const user = getOptionalAuth(c);
  const sessionId = c.req.param("id");
  const messageId = c.req.param("messageId");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  if (!messageId || !requireValidId(messageId)) return c.json({ message: "message not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const message = await getSessionMessageById(session.id, messageId);
  if (!message) return c.json({ message: "message not found" }, 404);
  const detail = c.req.query("detail") === "summary" ? "summary" : "full";

  return c.json({
    session,
    message: detail === "summary"
      ? summarizeMessageForHistory(message, { placeholderIntermediate: false })
      : markMessageAsFull(message),
  });
});

router.post("/:id/messages", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.prompt.fullaccess", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const space = await getSpaceById(session.spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{
    content: ContentBlock[];
    model?: string;
    provider?: string;
  }>();

  if (!body.content || body.content.length === 0) {
    return c.json({ message: "content is required" }, 400);
  }

  const userMessageId = crypto.randomUUID();
  const turnId = crypto.randomUUID();

  let content = body.content;
  let promptTemplateMeta: Record<string, unknown> | null = null;
  if (body.content.length === 1 && body.content[0]?.type === "text") {
    const rawText = typeof body.content[0].text === "string" ? body.content[0].text.trim() : "";
    if (rawText.startsWith("/")) {
      const expanded = await expandPromptTemplate(rawText, {
        userId: user?.uuid ?? null,
        spaceId: space.id,
      });
      if (expanded) {
        content = [{ type: "text", text: expanded.renderedText } satisfies ContentBlock];
        promptTemplateMeta = {
          name: expanded.template.name,
          description: expanded.template.description,
          argumentHint: expanded.template.argumentHint ?? null,
          category: expanded.template.category ?? null,
          scope: expanded.template.scope,
          rawInput: expanded.rawInput,
          args: expanded.args,
        };
      }
    }
  }

  try {
    await createSessionTurn({
      id: turnId,
      sessionId: session.id,
      userUuid: user?.uuid ?? null,
      userContent: content,
      intent: "steer",
      meta: {
        source: "web",
        model: body.model ?? null,
        provider: body.provider ?? null,
        promptTemplate: promptTemplateMeta,
        authorUuid: user?.uuid ?? null,
        authorName: (user?.nick_name as string | undefined) ?? null,
        authorAvatar: (user?.avatar_url as string | undefined) ?? null,
      },
    });
    await enqueueSpacePrompt({
      spaceId: space.id,
      sessionId: session.id,
      userMessageId,
      content,
      meta: {
        intent: "steer",
        source: "web",
        turnId,
        model: body.model ?? null,
        provider: body.provider ?? null,
        promptTemplate: promptTemplateMeta,
        actorUserId: user?.uuid ?? null,
        authorUuid: user?.uuid ?? null,
        authorName: (user?.nick_name as string | undefined) ?? null,
        authorAvatar: (user?.avatar_url as string | undefined) ?? null,
      },
    });
  } catch (error) {
    await failSessionTurn({
      sessionId: session.id,
      turnId,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    if (error instanceof SandboxNotReadyError) {
      return c.json({ message: "sandbox is not ready" }, 503);
    }
    throw error;
  }

  return c.json({ ok: true, userMessageId, turnId });
});

export default router;
