import type { ContentBlock, ResourcePermissionLevel } from "@cohub/protocol";
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { resourcePermissions } from "../db/schema-v2.js";
import { canReadForSession, canWrite } from "../permissions.js";
import { useAuth, requireValidId } from "../lib/middleware.js";
import {
  getSpaceById,
  getSpaceSessionById,
  listSessionMessages,
  enqueueSpacePrompt,
  SandboxNotReadyError,
} from "../space-sessions.js";

const router = new Hono();

// GET /api/sessions/:id
router.get("/:id", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await canReadForSession(user, session.spaceId, session.id)))
    return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(session.spaceId);
  if (!space) return c.json({ message: "session not found" }, 404);

  return c.json({ space, session, user });
});

// GET /api/sessions/:id/messages
router.get("/:id/messages", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await canReadForSession(user, session.spaceId, session.id)))
    return c.json({ message: "not found" }, 404);

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

// POST /api/sessions/:id/messages
router.post("/:id/messages", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await canWrite(user, session.spaceId, session.id)))
    return c.json({ message: "not found" }, 404);

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

// ── Session Permission Management ────────────────────────────────────────────

/**
 * POST /api/sessions/:id/permissions
 * Set public permission level for a session (granteeUuid = NULL).
 * Only the space owner can modify.
 */
router.post("/:id/permissions", async (c) => {
  const user = useAuth(c);
  const rawSessionId = c.req.param("id");
  if (!rawSessionId || !requireValidId(rawSessionId)) return c.json({ message: "session not found" }, 404);
  const sessionId = rawSessionId;

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  // Only space owner can set session permissions
  const space = await getSpaceById(session.spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ level: ResourcePermissionLevel }>().catch(() => null);
  if (!body || (body.level !== "read" && body.level !== "write" && body.level !== "private")) {
    return c.json({ message: "level must be 'read', 'write', or 'private'" }, 400);
  }

  const [perm] = await db
    .insert(resourcePermissions)
    .values({
      resourceType: "session",
      resourceId: sessionId,
      granteeUuid: null,
      level: body.level,
      createdBy: user.uuid,
    })
    .onConflictDoUpdate({
      target: [resourcePermissions.resourceType, resourcePermissions.resourceId, resourcePermissions.granteeUuid],
      set: { level: body.level },
    })
    .returning();

  return c.json(perm);
});

/**
 * DELETE /api/sessions/:id/permissions
 * Delete only the session public permission record (granteeUuid = NULL).
 */
router.delete("/:id/permissions", async (c) => {
  const user = useAuth(c);
  const rawSessionId = c.req.param("id");
  if (!rawSessionId || !requireValidId(rawSessionId)) return c.json({ message: "session not found" }, 404);
  const sessionId = rawSessionId;

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  // Only space owner can delete session permissions
  const space = await getSpaceById(session.spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "not found" }, 404);

  await db
    .delete(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "session"),
      eq(resourcePermissions.resourceId, sessionId),
      isNull(resourcePermissions.granteeUuid),
    ));

  return c.json({ ok: true });
});

export default router;
