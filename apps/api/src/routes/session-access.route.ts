import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accessPolicies, spaceSessions } from "../db/schema-v2.js";
import { requireValidId, useAuth } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import type { AccessPolicyRole } from "../db/schema-v2.js";

const router = new Hono();
const VALID_ROLE_VALUES = new Set<AccessPolicyRole>(["guest", null]);

router.get("/:id/access", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const [session] = await db.select({ spaceId: spaceSessions.spaceId }).from(spaceSessions).where(eq(spaceSessions.id, sessionId)).limit(1);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "member.view", { spaceId: session.spaceId, sessionId }))) return c.json({ message: "not found" }, 404);

  const [policy] = await db
    .select({ signed_in_user: accessPolicies.signedInUserRole, anonymous_user: accessPolicies.anonymousUserRole })
    .from(accessPolicies)
    .where(and(eq(accessPolicies.resourceType, "session"), eq(accessPolicies.resourceId, sessionId)))
    .limit(1);

  return c.json({
    signed_in_user: policy?.signed_in_user ?? null,
    anonymous_user: policy?.anonymous_user ?? null,
  });
});

router.put("/:id/access", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const [session] = await db.select({ spaceId: spaceSessions.spaceId }).from(spaceSessions).where(eq(spaceSessions.id, sessionId)).limit(1);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "member.manage", { spaceId: session.spaceId, sessionId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ signed_in_user?: AccessPolicyRole; anonymous_user?: AccessPolicyRole }>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);
  if (!VALID_ROLE_VALUES.has(body.signed_in_user ?? null) || !VALID_ROLE_VALUES.has(body.anonymous_user ?? null)) {
    return c.json({ message: "access role must be guest or null" }, 400);
  }

  const [policy] = await db
    .insert(accessPolicies)
    .values({
      resourceType: "session",
      resourceId: sessionId,
      signedInUserRole: body.signed_in_user ?? null,
      anonymousUserRole: body.anonymous_user ?? null,
      createdBy: user.uuid,
      updatedBy: user.uuid,
    })
    .onConflictDoUpdate({
      target: [accessPolicies.resourceType, accessPolicies.resourceId],
      set: {
        signedInUserRole: body.signed_in_user ?? null,
        anonymousUserRole: body.anonymous_user ?? null,
        updatedBy: user.uuid,
        updatedAt: new Date(),
      },
    })
    .returning();

  return c.json({
    signed_in_user: policy?.signedInUserRole ?? null,
    anonymous_user: policy?.anonymousUserRole ?? null,
  });
});

router.delete("/:id/access", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!sessionId || !requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const [session] = await db.select({ spaceId: spaceSessions.spaceId }).from(spaceSessions).where(eq(spaceSessions.id, sessionId)).limit(1);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await hasPermission(user, "member.manage", { spaceId: session.spaceId, sessionId }))) return c.json({ message: "not found" }, 404);

  await db.delete(accessPolicies).where(and(eq(accessPolicies.resourceType, "session"), eq(accessPolicies.resourceId, sessionId)));
  return c.json({ ok: true });
});

export default router;
