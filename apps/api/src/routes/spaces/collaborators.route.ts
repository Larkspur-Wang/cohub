import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { resourcePermissions } from "../../db/schema-v2.js";
import { useAuth, requireValidId } from "../../lib/middleware.js";
import { getSpaceById } from "../../space-sessions.js";
import { canRead } from "../../permissions.js";
import type { ResourcePermissionLevel } from "@cohub/protocol";

const router = new Hono();

/**
 * POST /api/spaces/:id/collaborators
 * Add a collaborator. Only the owner can do this.
 */
router.post("/", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  if (!rawSpaceId || !requireValidId(rawSpaceId)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ granteeUuid: string; level: ResourcePermissionLevel }>().catch(() => null);
  if (!body?.granteeUuid || !body?.level) {
    return c.json({ message: "granteeUuid and level are required" }, 400);
  }
  if (!requireValidId(body.granteeUuid)) {
    return c.json({ message: "granteeUuid must be a valid UUID" }, 400);
  }
  if (body.level !== "read" && body.level !== "write") {
    return c.json({ message: "level must be 'read' or 'write'" }, 400);
  }
  if (body.granteeUuid === user.uuid) {
    return c.json({ message: "cannot add yourself as collaborator" }, 400);
  }

  try {
    const [perm] = await db
      .insert(resourcePermissions)
      .values({
        resourceType: "space",
        resourceId: spaceId,
        granteeUuid: body.granteeUuid,
        level: body.level,
        createdBy: user.uuid,
      })
      .onConflictDoUpdate({
        target: [resourcePermissions.resourceType, resourcePermissions.resourceId, resourcePermissions.granteeUuid],
        set: { level: body.level },
      })
      .returning();
    return c.json(perm);
  } catch {
    return c.json({ message: "failed to add collaborator" }, 500);
  }
});

/**
 * GET /api/spaces/:id/collaborators
 * View collaborator list. Owner and collaborators can view.
 */
router.get("/", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  if (!rawSpaceId || !requireValidId(rawSpaceId)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;

  if (!(await canRead(user, spaceId))) {
    return c.json({ message: "not found" }, 404);
  }

  const collaborators = await db
    .select()
    .from(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "space"),
      eq(resourcePermissions.resourceId, spaceId),
    ))
    .orderBy(resourcePermissions.createdAt);

  // Only return records where granteeUuid != NULL (exclude public permissions)
  return c.json(collaborators.filter((p) => p.granteeUuid !== null));
});

/**
 * PATCH /api/spaces/:id/collaborators/:granteeUuid
 * Update collaborator permission level. Only the owner can do this.
 */
router.patch("/:granteeUuid", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  const rawGranteeUuid = c.req.param("granteeUuid");
  if (!rawSpaceId || !requireValidId(rawSpaceId) || !rawGranteeUuid || !requireValidId(rawGranteeUuid)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;
  const granteeUuid = rawGranteeUuid;

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ level: ResourcePermissionLevel }>().catch(() => null);
  if (!body?.level || (body.level !== "read" && body.level !== "write")) {
    return c.json({ message: "level must be 'read' or 'write'" }, 400);
  }

  const [updated] = await db
    .update(resourcePermissions)
    .set({ level: body.level })
    .where(and(
      eq(resourcePermissions.resourceType, "space"),
      eq(resourcePermissions.resourceId, spaceId),
      eq(resourcePermissions.granteeUuid, granteeUuid),
    ))
    .returning();

  if (!updated) return c.json({ message: "collaborator not found" }, 404);
  return c.json(updated);
});

/**
 * DELETE /api/spaces/:id/collaborators/:granteeUuid
 * Remove a collaborator. Only the owner can do this.
 */
router.delete("/:granteeUuid", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  const rawGranteeUuid = c.req.param("granteeUuid");
  if (!rawSpaceId || !requireValidId(rawSpaceId) || !rawGranteeUuid || !requireValidId(rawGranteeUuid)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;
  const granteeUuid = rawGranteeUuid;

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  await db
    .delete(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "space"),
      eq(resourcePermissions.resourceId, spaceId),
      eq(resourcePermissions.granteeUuid, granteeUuid),
    ));

  return c.json({ ok: true });
});

export default router;
