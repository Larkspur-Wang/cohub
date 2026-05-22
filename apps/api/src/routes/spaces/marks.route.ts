import { Hono, type Context } from "hono";
import { and, asc, count, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { checkpoints, spaceMarks, spaceSessions, spaces } from "@cohub/db";
import { requireValidId, useAuth, getOptionalAuth, authzDenied } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";

const router = new Hono();
const PIN_LIMIT = 10;
const MARK_KIND = "pin";
const RESOURCE_TYPES = new Set(["session", "checkpoint", "file", "space"]);
const GLOBAL_SPACE_PIN_SCOPE = "00000000-0000-4000-8000-000000000000";

function isGlobalPinScope(spaceId: string) {
  return spaceId === GLOBAL_SPACE_PIN_SCOPE;
}

function encodeGlobalSpacePinRef(userUuid: string, spaceId: string) {
  return `${userUuid}:${spaceId}`;
}

function decodeGlobalSpacePinRef(resourceRef: string) {
  const parts = resourceRef.split(":");
  return parts.length === 2 && parts[1] ? parts[1] : resourceRef;
}

function isSafeFilePath(path: string) {
  const trimmed = path.trim();
  return trimmed.length > 0 &&
    !trimmed.startsWith("/") &&
    !trimmed.includes("\0") &&
    !trimmed.split("/").some((part) => part === ".." || part === "");
}

function buildHref(spaceId: string, resourceType: string, resourceRef: string) {
  if (resourceType === "space") return `/spaces/${decodeGlobalSpacePinRef(resourceRef) || spaceId}`;
  if (resourceType === "session") return `/spaces/${spaceId}/sessions/${resourceRef}`;
  if (resourceType === "checkpoint") return `/spaces/${spaceId}/checkpoints/${resourceRef}`;
  if (resourceType === "file") return `/spaces/${spaceId}/files/${resourceRef.split("/").map(encodeURIComponent).join("/")}`;
  return `/spaces/${spaceId}`;
}

router.get("/", async (c) => {
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const globalScope = isGlobalPinScope(spaceId);
  if (globalScope) {
    const user = useAuth(c);
    return getSpaceMarks(c, spaceId, user, true);
  }
  const user = getOptionalAuth(c);
  return getSpaceMarks(c, spaceId, user, false);
});

async function getSpaceMarks(
  c: Context,
  spaceId: string,
  user: ReturnType<typeof getOptionalAuth>,
  globalScope: boolean,
) {
  if (!globalScope && !(await hasPermission(user, "space.view", { spaceId }))) return authzDenied(c);
  const userPrefix = globalScope ? `${user?.uuid ?? ""}:%` : "";

  const kind = c.req.query("kind") ?? MARK_KIND;
  if (kind !== MARK_KIND) return c.json({ marks: [] });

  const rows = await db
    .select()
    .from(spaceMarks)
    .where(and(
      eq(spaceMarks.spaceId, spaceId),
      eq(spaceMarks.kind, MARK_KIND),
      ...(globalScope ? [
        eq(spaceMarks.resourceType, "space"),
        sql`${spaceMarks.resourceRef} like ${userPrefix}`,
      ] : []),
    ))
    .orderBy(asc(spaceMarks.rank), asc(spaceMarks.createdAt));

  const sessionIds = rows.filter((m) => m.resourceType === "session").map((m) => m.resourceRef).filter(requireValidId);
  const checkpointIds = rows.filter((m) => m.resourceType === "checkpoint").map((m) => m.resourceRef).filter(requireValidId);
  const pinnedSpaceIds = rows
    .filter((m) => m.resourceType === "space")
    .map((m) => decodeGlobalSpacePinRef(m.resourceRef))
    .filter(requireValidId);

  const sessionRows = sessionIds.length > 0
    ? await db.select().from(spaceSessions).where(and(eq(spaceSessions.spaceId, spaceId), inArray(spaceSessions.id, sessionIds)))
    : [];
  const checkpointRows = checkpointIds.length > 0
    ? await db.select().from(checkpoints).where(and(eq(checkpoints.spaceId, spaceId), inArray(checkpoints.id, checkpointIds)))
    : [];
  const pinnedSpaceRows = pinnedSpaceIds.length > 0
    ? await db.select().from(spaces).where(inArray(spaces.id, [...new Set(globalScope ? pinnedSpaceIds : [...pinnedSpaceIds, spaceId])]))
    : [];

  const sessionsById = new Map(sessionRows.map((s) => [s.id, s]));
  const checkpointsById = new Map(checkpointRows.map((cp) => [cp.id, cp]));
  const spacesById = new Map(pinnedSpaceRows.map((space) => [space.id, space]));

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
    if (mark.resourceType === "space") {
      const pinnedSpaceId = decodeGlobalSpacePinRef(mark.resourceRef);
      const pinnedSpace = spacesById.get(pinnedSpaceId);
      if (!pinnedSpace) return [];
      return [{
        ...mark,
        resourceRef: pinnedSpaceId,
        href: buildHref(spaceId, mark.resourceType, mark.resourceRef),
        resource: {
          title: mark.label ?? pinnedSpace.name ?? "Untitled space",
          subtitle: pinnedSpace.description ?? null,
          status: null,
        },
      }];
    }
    return [];
  });

  return c.json({ marks });
}

router.post("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  const globalScope = isGlobalPinScope(spaceId);
  if (!globalScope && !(await hasPermission(user, "space.pin", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{
    kind?: string;
    resourceType?: string;
    resourceRef?: string;
    label?: string | null;
  }>().catch(() => null);
  const kind = body?.kind ?? MARK_KIND;
  const resourceType = body?.resourceType;
  const requestedResourceRef = body?.resourceRef?.trim();
  if (kind !== MARK_KIND) return c.json({ message: "unsupported mark kind" }, 400);
  if (!resourceType || !RESOURCE_TYPES.has(resourceType)) return c.json({ message: "unsupported resource type" }, 400);
  if (globalScope && resourceType !== "space") return c.json({ message: "global pin scope only supports space pins" }, 400);
  if (!requestedResourceRef) return c.json({ message: "resourceRef is required" }, 400);
  const resourceRef = globalScope && resourceType === "space"
    ? encodeGlobalSpacePinRef(user.uuid, requestedResourceRef)
    : requestedResourceRef;
  const targetResourceRef = decodeGlobalSpacePinRef(resourceRef);

  if (resourceType === "space") {
    if (!requireValidId(targetResourceRef)) return c.json({ message: "space not found" }, 404);
    if (!(await hasPermission(user, "space.view", { spaceId: targetResourceRef }))) return authzDenied(c);
    const [space] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, targetResourceRef)).limit(1);
    if (!space) return c.json({ message: "space not found" }, 404);
  } else if (resourceType === "session") {
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
      .where(and(
        eq(spaceMarks.spaceId, spaceId),
        eq(spaceMarks.kind, MARK_KIND),
        ...(globalScope ? [
        eq(spaceMarks.resourceType, "space"),
        sql`${spaceMarks.resourceRef} like ${`${user.uuid}:%`}`,
      ] : []),
      ));
    if (Number(currentCount) >= PIN_LIMIT) return { error: "pin limit reached" as const };

    const [{ value: maxRank } = { value: 0 }] = await tx
      .select({ value: max(spaceMarks.rank) })
      .from(spaceMarks)
      .where(and(
        eq(spaceMarks.spaceId, spaceId),
        eq(spaceMarks.kind, MARK_KIND),
        ...(globalScope ? [
        eq(spaceMarks.resourceType, "space"),
        sql`${spaceMarks.resourceRef} like ${`${user.uuid}:%`}`,
      ] : []),
      ));

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
  const globalScope = isGlobalPinScope(spaceId);
  if (!globalScope && !(await hasPermission(user, "space.pin", { spaceId }))) return authzDenied(c);

  await db.delete(spaceMarks).where(and(
    eq(spaceMarks.spaceId, spaceId),
    eq(spaceMarks.id, markId),
    ...(globalScope ? [sql`${spaceMarks.resourceRef} like ${`${user.uuid}:%`}`] : []),
  ));
  return c.json({ ok: true });
});

export default router;
