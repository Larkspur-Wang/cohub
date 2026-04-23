import type { ContentBlock } from "@cohub/protocol/core";
import { Hono } from "hono";
import { hasPermission } from "../permissions.js";
import { useAuth, requireValidId } from "../lib/middleware.js";
import {
  getSpaceById,
  getSpaceSessionById,
  listSessionMessages,
  enqueueSpacePrompt,
  SandboxNotReadyError,
} from "../space-sessions.js";

const router = new Hono();

router.get("/:id", async (c) => {
  const user = useAuth(c);
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

router.get("/:id/messages", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId: session.spaceId, sessionId: session.id }))) {
    return c.json({ message: "not found" }, 404);
  }

  const space = await getSpaceById(session.spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const cursorParam = c.req.query("cursor");
  const cursor = cursorParam ? Number(cursorParam) : undefined;
  const pageLimit = Math.min(Number(c.req.query("limit") ?? 30), 100) || 30;
  const direction = (c.req.query("direction") as "older" | "newer" | undefined) ?? "older";
  const fetchLimit = Math.min(pageLimit + 1, 101);

  const rows = await listSessionMessages(session.id, {
    cursor,
    limit: fetchLimit,
    direction,
  });
  const hasMore = rows.length > pageLimit;
  const messages = hasMore ? rows.slice(0, pageLimit) : rows;

  return c.json({
    space,
    session,
    messages,
    hasMore,
    nextCursor: messages.length > 0
      ? direction === "older"
        ? (messages[0]?.sequence ?? 0) - 1
        : (messages[messages.length - 1]?.sequence ?? 0)
      : undefined,
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
    clientMessageId?: string;
  }>();

  if (!body.content || body.content.length === 0) {
    return c.json({ message: "content is required" }, 400);
  }

  const userMessageId = crypto.randomUUID();

  try {
    await enqueueSpacePrompt({
      spaceId: space.id,
      sessionId: session.id,
      userMessageId,
      content: body.content,
      meta: {
        intent: "continue",
        source: "web",
        model: body.model ?? null,
        provider: body.provider ?? null,
        authorUuid: user?.uuid ?? null,
        authorName: (user?.nick_name as string | undefined) ?? null,
        authorAvatar: (user?.avatar_url as string | undefined) ?? null,
        clientMessageId: body.clientMessageId?.trim() || null,
      },
    });
  } catch (error) {
    if (error instanceof SandboxNotReadyError) {
      return c.json({ message: "sandbox is not ready" }, 503);
    }
    throw error;
  }

  return c.json({ ok: true, userMessageId });
});

export default router;
