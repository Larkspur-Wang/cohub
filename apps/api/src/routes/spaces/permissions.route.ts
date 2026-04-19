import { Hono } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { resourcePermissions, spaceSessions } from "../../db/schema-v2.js";
import { useAuth, requireValidId } from "../../lib/middleware.js";
import { getSpaceById } from "../../space-sessions.js";
import type { ResourcePermissionLevel } from "@cohub/protocol";

const router = new Hono();

/**
 * POST /api/spaces/:id/permissions
 * Set public permission level for a space (granteeUuid = NULL).
 * Only the space owner can modify.
 */
router.post("/", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  if (!rawSpaceId || !requireValidId(rawSpaceId)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ level: ResourcePermissionLevel }>().catch(() => null);
  if (!body || (body.level !== "read" && body.level !== "write" && body.level !== "private")) {
    return c.json({ message: "level must be 'read', 'write', or 'private'" }, 400);
  }

  const [perm] = await db
    .insert(resourcePermissions)
    .values({
      resourceType: "space",
      resourceId: spaceId,
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
 * GET /api/spaces/:id/permissions
 * Returns public permission records + session-level permission records.
 * (Collaborator list uses GET /api/spaces/:id/collaborators)
 */
router.get("/", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  if (!rawSpaceId || !requireValidId(rawSpaceId)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  const sessions = await db.select({ id: spaceSessions.id }).from(spaceSessions).where(eq(spaceSessions.spaceId, spaceId));
  const resourceIds = [spaceId, ...sessions.map((s) => s.id)];

  const perms = await db
    .select()
    .from(resourcePermissions)
    .where(inArray(resourcePermissions.resourceId, resourceIds))
    .orderBy(resourcePermissions.createdAt);

  return c.json(perms);
});

/**
 * DELETE /api/spaces/:id/permissions
 * Delete only the public permission record (granteeUuid = NULL).
 */
router.delete("/", async (c) => {
  const user = useAuth(c);
  const rawSpaceId = c.req.param("id");
  if (!rawSpaceId || !requireValidId(rawSpaceId)) return c.json({ message: "space not found" }, 404);
  const spaceId = rawSpaceId;

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  await db
    .delete(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "space"),
      eq(resourcePermissions.resourceId, spaceId),
      isNull(resourcePermissions.granteeUuid),
    ));

  return c.json({ ok: true });
});

export default router;
