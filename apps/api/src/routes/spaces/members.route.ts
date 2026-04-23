import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { spaceMembers } from "../../db/schema-v2.js";
import { requireValidId, useAuth } from "../../lib/middleware.js";
import { getSpaceById } from "../../space-sessions.js";
import { hasPermission, getRoleForSpaceUser } from "../../permissions.js";
import type { SpaceRole } from "../../db/schema-v2.js";

const VALID_ROLES: SpaceRole[] = ["host", "maker", "guest"];
const router = new Hono();

router.get("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "member.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const items = await db
    .select({
      userId: spaceMembers.userId,
      role: spaceMembers.role,
      createdAt: spaceMembers.createdAt,
      updatedAt: spaceMembers.updatedAt,
    })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId))
    .orderBy(spaceMembers.createdAt);

  return c.json({ items });
});

router.put("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "member.manage", { spaceId }))) return c.json({ message: "not found" }, 404);
  const actorRole = await getRoleForSpaceUser(spaceId, user.uuid);
  if (actorRole !== "host") return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ userId?: string; role?: SpaceRole }>().catch(() => null);
  if (!body?.userId || !body.role) return c.json({ message: "userId and role are required" }, 400);
  if (!requireValidId(body.userId)) return c.json({ message: "userId must be a valid UUID" }, 400);
  if (!VALID_ROLES.includes(body.role)) return c.json({ message: "invalid role" }, 400);

  const existingMembers = await db
    .select({ userId: spaceMembers.userId, role: spaceMembers.role })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId));
  const current = existingMembers.find((item) => item.userId === body.userId);
  if (current?.role === "host" && body.role !== "host") {
    const hostCount = existingMembers.filter((item) => item.role === "host").length;
    if (hostCount <= 1) return c.json({ message: "cannot demote the last host" }, 400);
  }

  const [member] = await db
    .insert(spaceMembers)
    .values({
      spaceId,
      userId: body.userId,
      role: body.role,
      createdBy: user.uuid,
      updatedBy: user.uuid,
    })
    .onConflictDoUpdate({
      target: [spaceMembers.spaceId, spaceMembers.userId],
      set: { role: body.role, updatedBy: user.uuid, updatedAt: new Date() },
    })
    .returning();

  return c.json(member);
});

router.delete("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "member.manage", { spaceId }))) return c.json({ message: "not found" }, 404);
  const actorRole = await getRoleForSpaceUser(spaceId, user.uuid);
  if (actorRole !== "host") return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ userId?: string }>().catch(() => null);
  if (!body?.userId || !requireValidId(body.userId)) return c.json({ message: "userId is required" }, 400);

  const existing = await db
    .select({ role: spaceMembers.role, userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId));

  const target = existing.find((item) => item.userId === body.userId);
  if (!target) return c.json({ ok: true });

  if (target.role === "host") {
    const hostCount = existing.filter((item) => item.role === "host").length;
    if (hostCount <= 1) return c.json({ message: "cannot remove the last host" }, 400);
  }

  await db
    .delete(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, body.userId)));

  return c.json({ ok: true });
});

export default router;
