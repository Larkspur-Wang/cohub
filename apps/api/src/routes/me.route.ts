import { Hono } from "hono";
import { useAuth } from "../lib/middleware.js";

const router = new Hono();

router.get("/", (c) => {
  const user = useAuth(c);
  return c.json(user);
});

export default router;
