import { Hono, type Context } from "hono";
import { and, asc, count, eq, inArray, max, sql } from "drizzle-orm";
import { checkpoints, labelAssignments, labels, spaceSessions } from "@cohub/db";
import { db } from "../../db/index.js";
import { getOptionalAuth, requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";

const router = new Hono();
const SCOPE_TYPE = "space";
const RESOURCE_TYPES = new Set(["session", "checkpoint", "file"]);

function slugifyLabelName(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "label";
}

function normalizeName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return null;
  return name;
}

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

function buildLabelTree(rows: Array<typeof labels.$inferSelect>) {
  const sorted = [...rows].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.name.localeCompare(b.name);
  });
  const byId = new Map(sorted.map((label) => [label.id, { ...label, children: [] as Array<typeof label & { children: never[] }> }]));
  const roots: Array<typeof sorted[number] & { children: Array<typeof sorted[number]> }> = [];
  for (const label of byId.values()) {
    if (label.parentId) {
      const parent = byId.get(label.parentId);
      if (parent) {
        parent.children.push(label as never);
        continue;
      }
    }
    roots.push(label as never);
  }
  return roots;
}

async function requireSpacePermission(c: Context, permission: Parameters<typeof hasPermission>[1]) {
  const user = permission === "space.label.view" ? getOptionalAuth(c) : useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return { error: c.json({ message: "space not found" }, 404) };
  if (!(await hasPermission(user, permission, { spaceId }))) return { error: c.json({ message: "not found" }, 404) };
  return { user, spaceId };
}

async function getScopeLabels(spaceId: string) {
  return db
    .select()
    .from(labels)
    .where(and(eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, spaceId)))
    .orderBy(asc(labels.rank), asc(labels.name));
}

async function getLabelInSpace(spaceId: string, labelId: string) {
  const [label] = await db
    .select()
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, spaceId)))
    .limit(1);
  return label ?? null;
}

async function validateResource(spaceId: string, resourceType: string, resourceRef: string) {
  if (!RESOURCE_TYPES.has(resourceType)) return false;
  if (resourceType === "file") return isSafeFilePath(resourceRef);
  if (!requireValidId(resourceRef)) return false;
  if (resourceType === "session") {
    const [row] = await db.select({ id: spaceSessions.id }).from(spaceSessions).where(and(eq(spaceSessions.spaceId, spaceId), eq(spaceSessions.id, resourceRef))).limit(1);
    return Boolean(row);
  }
  const [row] = await db.select({ id: checkpoints.id }).from(checkpoints).where(and(eq(checkpoints.spaceId, spaceId), eq(checkpoints.id, resourceRef))).limit(1);
  return Boolean(row);
}

async function hydrateAssignments(spaceId: string, rows: Array<typeof labelAssignments.$inferSelect>) {
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

  return rows.flatMap((assignment) => {
    if (assignment.resourceType === "session") {
      const session = sessionsById.get(assignment.resourceRef);
      if (!session) return [];
      return [{
        ...assignment,
        href: buildHref(spaceId, assignment.resourceType, assignment.resourceRef),
        resource: {
          title: session.title ?? session.latestMessageText ?? "New chat",
          subtitle: session.lastMessageAt ? new Date(session.lastMessageAt).toISOString() : null,
          status: session.status ?? null,
        },
      }];
    }
    if (assignment.resourceType === "checkpoint") {
      const checkpoint = checkpointsById.get(assignment.resourceRef);
      if (!checkpoint) return [];
      return [{
        ...assignment,
        href: buildHref(spaceId, assignment.resourceType, assignment.resourceRef),
        resource: {
          title: checkpoint.description || checkpoint.commitHash.slice(0, 12),
          subtitle: checkpoint.createdAt ? new Date(checkpoint.createdAt).toISOString() : null,
          status: null,
        },
      }];
    }
    if (assignment.resourceType === "file") {
      return [{
        ...assignment,
        href: buildHref(spaceId, assignment.resourceType, assignment.resourceRef),
        resource: {
          title: assignment.resourceRef.split("/").pop() ?? assignment.resourceRef,
          subtitle: assignment.resourceRef,
          status: null,
        },
      }];
    }
    return [];
  });
}

router.get("/", async (c) => {
  const access = await requireSpacePermission(c, "space.label.view");
  if (access.error) return access.error;
  const rows = await getScopeLabels(access.spaceId);
  return c.json({ labels: buildLabelTree(rows) });
});

router.post("/", async (c) => {
  const access = await requireSpacePermission(c, "space.label.manage");
  if (access.error) return access.error;
  const body = await c.req.json<{ name?: string; parentId?: string | null }>().catch(() => null);
  const name = normalizeName(body?.name);
  if (!name) return c.json({ message: "name is required" }, 400);
  const parentId = body?.parentId ?? null;
  let depth = 0;
  if (parentId) {
    if (!requireValidId(parentId)) return c.json({ message: "parent label not found" }, 404);
    const parent = await getLabelInSpace(access.spaceId, parentId);
    if (parent?.depth !== 0) return c.json({ message: "parent label not found" }, 404);
    depth = 1;
  }
  const [{ value: maxRank } = { value: 0 }] = await db.select({ value: max(labels.rank) }).from(labels).where(and(eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId), parentId ? eq(labels.parentId, parentId) : sql`${labels.parentId} is null`));
  const [label] = await db.insert(labels).values({
    scopeType: SCOPE_TYPE,
    scopeId: access.spaceId,
    name,
    slug: slugifyLabelName(name),
    parentId,
    depth,
    rank: Number(maxRank ?? 0) + 10,
    source: "user",
    createdBy: access.user?.uuid ?? null,
  }).returning();
  return c.json({ label }, 201);
});

router.post("/reorder", async (c) => {
  const access = await requireSpacePermission(c, "space.label.manage");
  if (access.error) return access.error;
  const body = await c.req.json<{ labelIds?: string[] }>().catch(() => null);
  const labelIds = [...new Set(body?.labelIds ?? [])];
  if (!Array.isArray(labelIds) || labelIds.some((id) => !requireValidId(id))) return c.json({ message: "labelIds are required" }, 400);
  const matched = labelIds.length > 0
    ? await db.select({ id: labels.id }).from(labels).where(and(eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId), inArray(labels.id, labelIds)))
    : [];
  if (matched.length !== labelIds.length) return c.json({ message: "label not found" }, 404);
  await db.transaction(async (tx) => {
    for (const [index, labelId] of labelIds.entries()) {
      await tx.update(labels).set({ rank: (index + 1) * 10, updatedAt: new Date() }).where(and(eq(labels.id, labelId), eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId)));
    }
  });
  return c.json({ labels: buildLabelTree(await getScopeLabels(access.spaceId)) });
});

router.patch("/:labelId", async (c) => {
  const access = await requireSpacePermission(c, "space.label.manage");
  if (access.error) return access.error;
  const labelId = c.req.param("labelId");
  if (!labelId || !requireValidId(labelId)) return c.json({ message: "label not found" }, 404);
  const label = await getLabelInSpace(access.spaceId, labelId);
  if (!label) return c.json({ message: "label not found" }, 404);
  const body = await c.req.json<{ name?: string; parentId?: string | null; rank?: number }>().catch(() => null);
  const patch: Partial<typeof labels.$inferInsert> = { updatedAt: new Date() };
  if (body?.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) return c.json({ message: "name is required" }, 400);
    patch.name = name;
    patch.slug = slugifyLabelName(name);
  }
  if (body?.rank !== undefined) {
    const rank = Number(body.rank);
    if (!Number.isSafeInteger(rank) || rank < -1_000_000 || rank > 1_000_000) return c.json({ message: "invalid rank" }, 400);
    patch.rank = rank;
  }
  if (body?.parentId !== undefined) {
    const parentId = body.parentId ?? null;
    if (parentId === labelId) return c.json({ message: "invalid parent label" }, 400);
    let depth = 0;
    if (parentId) {
      if (!requireValidId(parentId)) return c.json({ message: "parent label not found" }, 404);
      const parent = await getLabelInSpace(access.spaceId, parentId);
      if (parent?.depth !== 0) return c.json({ message: "parent label not found" }, 404);
      depth = 1;
    }
    const [{ value: childCount } = { value: 0 }] = await db.select({ value: count() }).from(labels).where(eq(labels.parentId, labelId));
    if (depth === 1 && Number(childCount) > 0) return c.json({ message: "label has child labels" }, 400);
    patch.parentId = parentId;
    patch.depth = depth;
  }
  const [updated] = await db.update(labels).set(patch).where(and(eq(labels.id, labelId), eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId))).returning();
  return c.json({ label: updated });
});

router.delete("/:labelId", async (c) => {
  const access = await requireSpacePermission(c, "space.label.manage");
  if (access.error) return access.error;
  const labelId = c.req.param("labelId");
  if (!labelId || !requireValidId(labelId)) return c.json({ message: "label not found" }, 404);
  const label = await getLabelInSpace(access.spaceId, labelId);
  if (!label) return c.json({ message: "label not found" }, 404);
  const [{ value: childCount } = { value: 0 }] = await db.select({ value: count() }).from(labels).where(and(eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId), eq(labels.parentId, labelId)));
  if (Number(childCount) > 0) return c.json({ message: "delete child labels first" }, 400);
  await db.transaction(async (tx) => {
    await tx.delete(labelAssignments).where(and(eq(labelAssignments.scopeType, SCOPE_TYPE), eq(labelAssignments.scopeId, access.spaceId), eq(labelAssignments.labelId, labelId)));
    await tx.delete(labels).where(and(eq(labels.id, labelId), eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId)));
  });
  return c.json({ ok: true });
});

router.get("/:labelId/items", async (c) => {
  const access = await requireSpacePermission(c, "space.label.view");
  if (access.error) return access.error;
  const labelId = c.req.param("labelId");
  if (!labelId || !requireValidId(labelId) || !(await getLabelInSpace(access.spaceId, labelId))) return c.json({ message: "label not found" }, 404);
  const rows = await db.select().from(labelAssignments).where(and(eq(labelAssignments.scopeType, SCOPE_TYPE), eq(labelAssignments.scopeId, access.spaceId), eq(labelAssignments.labelId, labelId))).orderBy(asc(labelAssignments.rank), asc(labelAssignments.createdAt));
  return c.json({ items: await hydrateAssignments(access.spaceId, rows) });
});

router.post("/:labelId/items", async (c) => {
  const access = await requireSpacePermission(c, "space.label.assign");
  if (access.error) return access.error;
  const labelId = c.req.param("labelId");
  if (!labelId || !requireValidId(labelId) || !(await getLabelInSpace(access.spaceId, labelId))) return c.json({ message: "label not found" }, 404);
  const body = await c.req.json<{ resourceType?: string; resourceRef?: string }>().catch(() => null);
  const resourceType = body?.resourceType ?? "";
  const resourceRef = body?.resourceRef?.trim() ?? "";
  if (!resourceRef || !(await validateResource(access.spaceId, resourceType, resourceRef))) return c.json({ message: "resource not found" }, 404);
  const [{ value: maxRank } = { value: 0 }] = await db.select({ value: max(labelAssignments.rank) }).from(labelAssignments).where(eq(labelAssignments.labelId, labelId));
  const [assignment] = await db.insert(labelAssignments).values({
    labelId,
    scopeType: SCOPE_TYPE,
    scopeId: access.spaceId,
    resourceType,
    resourceRef,
    rank: Number(maxRank ?? 0) + 10,
    source: "user",
    createdBy: access.user?.uuid ?? null,
  }).onConflictDoNothing().returning();
  if (assignment) return c.json({ assignment }, 201);
  const [existing] = await db.select().from(labelAssignments).where(and(eq(labelAssignments.labelId, labelId), eq(labelAssignments.resourceType, resourceType), eq(labelAssignments.resourceRef, resourceRef))).limit(1);
  return c.json({ assignment: existing }, existing ? 200 : 409);
});

router.delete("/:labelId/items/:assignmentId", async (c) => {
  const access = await requireSpacePermission(c, "space.label.assign");
  if (access.error) return access.error;
  const labelId = c.req.param("labelId");
  const assignmentId = c.req.param("assignmentId");
  if (!labelId || !requireValidId(labelId) || !assignmentId || !requireValidId(assignmentId)) return c.json({ message: "not found" }, 404);
  await db.delete(labelAssignments).where(and(eq(labelAssignments.id, assignmentId), eq(labelAssignments.labelId, labelId), eq(labelAssignments.scopeType, SCOPE_TYPE), eq(labelAssignments.scopeId, access.spaceId)));
  return c.json({ ok: true });
});

export async function getResourceLabels(c: Context) {
  const access = await requireSpacePermission(c, "space.label.view");
  if (access.error) return access.error;
  const resourceType = c.req.param("resourceType") ?? "";
  const resourceRef = c.req.query("resourceRef")?.trim() ?? "";
  if (!resourceRef || !RESOURCE_TYPES.has(resourceType)) return c.json({ message: "resource not found" }, 404);
  if (resourceType === "file" && !isSafeFilePath(resourceRef)) return c.json({ message: "resource not found" }, 404);
  const [allLabels, assignments] = await Promise.all([
    getScopeLabels(access.spaceId),
    db.select().from(labelAssignments).where(and(eq(labelAssignments.scopeType, SCOPE_TYPE), eq(labelAssignments.scopeId, access.spaceId), eq(labelAssignments.resourceType, resourceType), eq(labelAssignments.resourceRef, resourceRef))),
  ]);
  return c.json({ labels: buildLabelTree(allLabels), assignments });
}

export async function setResourceLabels(c: Context) {
  const access = await requireSpacePermission(c, "space.label.assign");
  if (access.error) return access.error;
  const resourceType = c.req.param("resourceType") ?? "";
  const resourceRef = c.req.query("resourceRef")?.trim() ?? "";
  if (!resourceRef || !(await validateResource(access.spaceId, resourceType, resourceRef))) return c.json({ message: "resource not found" }, 404);
  const body = await c.req.json<{ labelIds?: string[] }>().catch(() => null);
  const labelIds: string[] = [...new Set(body?.labelIds ?? [])];
  if (labelIds.some((id) => !requireValidId(id))) return c.json({ message: "labelIds are required" }, 400);
  const rows = labelIds.length > 0
    ? await db.select().from(labels).where(and(eq(labels.scopeType, SCOPE_TYPE), eq(labels.scopeId, access.spaceId), inArray(labels.id, labelIds)))
    : [];
  if (rows.length !== labelIds.length) return c.json({ message: "label not found" }, 404);
  await db.transaction(async (tx) => {
    await tx.delete(labelAssignments).where(and(eq(labelAssignments.scopeType, SCOPE_TYPE), eq(labelAssignments.scopeId, access.spaceId), eq(labelAssignments.resourceType, resourceType), eq(labelAssignments.resourceRef, resourceRef)));
    for (const [index, labelId] of labelIds.entries()) {
      await tx.insert(labelAssignments).values({
        labelId,
        scopeType: SCOPE_TYPE,
        scopeId: access.spaceId,
        resourceType,
        resourceRef,
        rank: (index + 1) * 10,
        source: "user",
        createdBy: access.user?.uuid ?? null,
      }).onConflictDoNothing();
    }
  });
  const [allLabels, assignments] = await Promise.all([
    getScopeLabels(access.spaceId),
    db.select().from(labelAssignments).where(and(eq(labelAssignments.scopeType, SCOPE_TYPE), eq(labelAssignments.scopeId, access.spaceId), eq(labelAssignments.resourceType, resourceType), eq(labelAssignments.resourceRef, resourceRef))),
  ]);
  return c.json({ labels: buildLabelTree(allLabels), assignments });
}

export default router;
