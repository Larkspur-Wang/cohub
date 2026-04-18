import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth, useAuth, requireValidId } from "../../lib/middleware.js";
import { canRead } from "../../permissions.js";
import { getSpaceById, readSpaceOutputStream } from "../../space-sessions.js";

const router = new Hono();

// GET /:id/stream
router.get("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canRead(user, spaceId))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const lastEventId = c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? undefined;

  return streamSSE(c, async (stream) => {
    const heartbeatMs = 25000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (c.req.raw.signal.aborted || stream.aborted || stream.closed) return;
      void stream.write(`: ping ${Date.now()}\n\n`).catch(() => undefined);
    }, heartbeatMs);
    stream.onAbort(() => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    });
    try {
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ spaceId: space.id }) });
      const output = await readSpaceOutputStream({
        spaceId: space.id,
        lastEventId,
        signal: c.req.raw.signal,
      });
      for await (const item of output) {
        if (stream.aborted || stream.closed) break;
        if (!item.payload) continue;
        await stream.writeSSE({ id: item.id, event: "message", data: item.payload });
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  });
});

export default router;
