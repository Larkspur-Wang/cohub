import { Hono } from "hono";
import { isRedisReady } from "../redis.js";

const router = new Hono();

router.get("/healthz", async (c) => {
  const redisReady = await isRedisReady();
  return c.json({ ok: true, redisReady });
});

router.get("/readyz", (c) => {
  return c.json({ ok: true });
});

export default router;
