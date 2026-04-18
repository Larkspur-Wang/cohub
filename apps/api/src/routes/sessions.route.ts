import { Hono } from "hono";
import { getSpaceById, getSpaceSessionById } from "../space-sessions.js";
import { canReadForSession } from "../permissions.js";
import { useAuth, requireValidId } from "../lib/middleware.js";

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

export default router;
