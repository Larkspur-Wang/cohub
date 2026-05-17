import { Hono } from "hono";
import { and, asc, count, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { checkpoints, spaceMarks, spaceSessions } from "@cohub/db";
import { requireValidId, useAuth, getOptionalAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";

const router = new Hono();
const PIN_LIMIT = 10;
const MARK_KIND = "pin";
const RESOURCE_TYPES = new Set(["session", "checkpoint", "file"]);

function isSafeFilePath(path: string) {
  const trimmed = path.trim();
  return trimmed.length > 0 &&
    !trimmed.startsWith("/") &&
    !trimmed.includes("\0") &&
    !trimmed.split("/").some((part) => part === ".." || part === "");
}

function buildHref(spaceId: string, resourceType: string, resourceRef: string) {
  if (resourceType === "session") return `/spaces/${spaceId}/sessions/${resourceRef}`;
  if (resourceType === "checkpoint") return `/spaces/${spaceId}/checkpoints/${resourceRef}`;
  if (resourceType === "file") return `/spaces/${spaceId}/files/${resourceRef.split("/").map(encodeURIComponent).join("/")}`;
  return `/spaces/${spaceId}`;
}

router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const kind = c.req.query("kind") ?? MARK_KIND;
  if (kind !== MARK_KIND) return c.json({ marks: [] });

  const rows = await db
    .select()
    .from(spaceMarks)
    .where(and(eq(spaceMarks.spaceId, spaceId), eq(spaceMarks.kind, MARK_KIND)))
    .orderBy(asc(spaceMarks.rank), asc(spaceMarks.createdAt));

  const sessionIds = rows.filter((m) => m.resourceType === "session").map((m) => m.resourceRef).filter(requireValidId);
  const checkpointIds = rows.filter((m) => m.resourceType === "checkpoint").map((m) => m.resourceRef).filter(requireValidId);

  const sessionRows = sessionIds.length > 0
    ? await db.select().from(spaceSessions).where(and(eq(spaceSessions.spaceId, spaceId), inArray(spaceSessions.id, sessionIds)))
    : [];
  const checkpointRows = checkpointIds.length > 0
    ? await db.select().from(checkpoints).where(and(eq(checkpoints.spaceId, spaceId), inArray(checkpoints.id, checkpointIds)))
    : [];

  const sessionsById = new Map(sessionRows.map((s) => [s.id, s]));
  const checkpointsById = new Map(checkpointRows.map((cp) => [cp.id, cp]));

  const marks = rows.flatMap((mark) => {
    if (mark.resourceType === "session") {
      const session = sessionsById.get(mark.resourceRef);
      if (!session) return [];
      return [{
        ...mark,
        href: buildHref(spaceId, mark.resourceType, mark.resourceRef),
        resource: {
          title: mark.label ?? session.title ?? session.latestMessageText ?? "New chat",
          subtitle: session.lastMessageAt ? new Date(session.lastMessageAt).toISOString() : null,
          status: session.status ?? null,
        },
      }];
    }
    if (mark.resourceType === "checkpoint") {
      const checkpoint = checkpointsById.get(mark.resourceRef);
      if (!checkpoint) return [];
      return [{
        ...mark,
        href: buildHref(spaceId, mark.resourceType, mark.resourceRef),
        resource: {
          title: mark.label ?? (checkpoint.description || checkpoint.commitHash.slice(0, 12)),
          subtitle: checkpoint.createdAt ? new Date(checkpoint.createdAt).toISOString() : null,
          status: null,
        },
      }];
    }
    if (mark.resourceType === "file") {
      const title = mark.label ?? mark.resourceRef.split("/").pop() ?? mark.resourceRef;
      return [{
        ...mark,
        href: buildHref(spaceId, mark.resourceType, mark.resourceRef),
        resource: {
          title,
          subtitle: mark.resourceRef,
          status: null,
        },
      }];
    }
    return [];
  });

  return c.json({ marks });
});

router.post("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.pin", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{
    kind?: string;
    resourceType?: string;
    resourceRef?: string;
    label?: string | null;
  }>().catch(() => null);
  const kind = body?.kind ?? MARK_KIND;
  const resourceType = body?.resourceType;
  const resourceRef = body?.resourceRef?.trim();
  if (kind !== MARK_KIND) return c.json({ message: "unsupported mark kind" }, 400);
  if (!resourceType || !RESOURCE_TYPES.has(resourceType)) return c.json({ message: "unsupported resource type" }, 400);
  if (!resourceRef) return c.json({ message: "resourceRef is required" }, 400);

  if (resourceType === "session") {
    if (!requireValidId(resourceRef)) return c.json({ message: "session not found" }, 404);
    const [session] = await db.select({ id: spaceSessions.id }).from(spaceSessions).where(and(eq(spaceSessions.spaceId, spaceId), eq(spaceSessions.id, resourceRef))).limit(1);
    if (!session) return c.json({ message: "session not found" }, 404);
  } else if (resourceType === "checkpoint") {
    if (!requireValidId(resourceRef)) return c.json({ message: "checkpoint not found" }, 404);
    const [checkpoint] = await db.select({ id: checkpoints.id }).from(checkpoints).where(and(eq(checkpoints.spaceId, spaceId), eq(checkpoints.id, resourceRef))).limit(1);
    if (!checkpoint) return c.json({ message: "checkpoint not found" }, 404);
  } else if (!isSafeFilePath(resourceRef)) {
    return c.json({ message: "invalid file path" }, 400);
  }

  const [existing] = await db.select().from(spaceMarks).where(and(
    eq(spaceMarks.spaceId, spaceId),
    eq(spaceMarks.kind, MARK_KIND),
    eq(spaceMarks.resourceType, resourceType),
    eq(spaceMarks.resourceRef, resourceRef),
  )).limit(1);
  if (existing) return c.json({ mark: existing });

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from v2.spaces where id = ${spaceId} for update`);

    const [{ value: currentCount } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(spaceMarks)
      .where(and(eq(spaceMarks.spaceId, spaceId), eq(spaceMarks.kind, MARK_KIND)));
    if (Number(currentCount) >= PIN_LIMIT) return { error: "pin limit reached" as const };

    const [{ value: maxRank } = { value: 0 }] = await tx
      .select({ value: max(spaceMarks.rank) })
      .from(spaceMarks)
      .where(and(eq(spaceMarks.spaceId, spaceId), eq(spaceMarks.kind, MARK_KIND)));

    const [mark] = await tx.insert(spaceMarks).values({
      spaceId,
      kind: MARK_KIND,
      resourceType,
      resourceRef,
      label: body?.label ?? null,
      rank: Number(maxRank ?? 0) + 10,
      createdBy: user.uuid,
    }).onConflictDoNothing().returning();

    if (mark) return { mark };

    const [conflicted] = await tx.select().from(spaceMarks).where(and(
      eq(spaceMarks.spaceId, spaceId),
      eq(spaceMarks.kind, MARK_KIND),
      eq(spaceMarks.resourceType, resourceType),
      eq(spaceMarks.resourceRef, resourceRef),
    )).limit(1);
    return { mark: conflicted };
  });

  if (result.error) return c.json({ message: result.error }, 400);
  return c.json({ mark: result.mark }, result.mark ? 201 : 409);
});

router.delete("/:markId", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const markId = c.req.param("markId");
  if (!spaceId || !requireValidId(spaceId) || !markId || !requireValidId(markId)) return c.json({ message: "not found" }, 404);
  if (!(await hasPermission(user, "space.pin", { spaceId }))) return c.json({ message: "not found" }, 404);

  await db.delete(spaceMarks).where(and(eq(spaceMarks.spaceId, spaceId), eq(spaceMarks.id, markId)));
  return c.json({ ok: true });
});

export default router;
