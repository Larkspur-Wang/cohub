import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accessPolicies } from "../../db/schema-v2.js";
import { requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import type { AccessPolicyRole } from "../../db/schema-v2.js";

const router = new Hono();
const SIGNED_IN_VALID_ROLES = new Set<AccessPolicyRole>(["maker", "guest", null]);
const ANONYMOUS_VALID_ROLES = new Set<AccessPolicyRole>(["guest", null]);

router.get("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "member.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const [policy] = await db
    .select({
      signed_in_user: accessPolicies.signedInUserRole,
      anonymous_user: accessPolicies.anonymousUserRole,
    })
    .from(accessPolicies)
    .where(and(eq(accessPolicies.resourceType, "space"), eq(accessPolicies.resourceId, spaceId)))
    .limit(1);

  return c.json({
    signed_in_user: policy?.signed_in_user ?? null,
    anonymous_user: policy?.anonymous_user ?? null,
  });
});

router.put("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "member.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ signed_in_user?: AccessPolicyRole; anonymous_user?: AccessPolicyRole }>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);
  if (!SIGNED_IN_VALID_ROLES.has(body.signed_in_user ?? null) || !ANONYMOUS_VALID_ROLES.has(body.anonymous_user ?? null)) {
    return c.json({ message: "access role must be guest, maker (signed-in only), or null" }, 400);
  }

  const [policy] = await db
    .insert(accessPolicies)
    .values({
      resourceType: "space",
      resourceId: spaceId,
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

export default router;
