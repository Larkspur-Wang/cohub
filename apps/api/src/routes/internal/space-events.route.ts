import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import { ensureInternalRequest, requireValidId } from "../../lib/middleware.js";
import { dispatchRealtimeEventToUsers, getReadableUserIdsForSpace } from "../../channels.js";

const router = new Hono();

router.post("/:spaceId/fs-changed", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const spaceId = c.req.param("spaceId");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const payload = await c.req.json<SpaceFsChangedPayload>().catch(() => null);
  if (!payload || !Array.isArray(payload.changes)) return c.json({ message: "fs payload is required" }, 400);

  const readableUserIds = await getReadableUserIdsForSpace(spaceId);
  await dispatchRealtimeEventToUsers({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "space",
    type: "space.fs.changed",
    spaceId,
    sessionId: null,
    payload: {
      ...payload,
      targetUserIds: readableUserIds,
    },
  });

  return c.json({ ok: true });
});

export default router;
