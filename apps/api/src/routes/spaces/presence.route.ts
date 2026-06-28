import { Hono } from "hono";
import { hasPermission } from "../../permissions.js";
import { getSpacePresenceSnapshot } from "../../space-presence.js";
import { authzDenied, requireValidId, useAuth } from "../../lib/middleware.js";

const router = new Hono();

router.get("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return authzDenied(c);

  return c.json(await getSpacePresenceSnapshot(spaceId));
});

export default router;
