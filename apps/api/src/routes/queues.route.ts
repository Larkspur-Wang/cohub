import { getQueueSnapshots } from "@cohub/bullmq-ops";
import { Hono } from "hono";
import { agentTurnQueue } from "../agent-turn-queue.js";
import { fsCdnQueue } from "../space-fs-cdn-queue.js";
import { taskQueue } from "../tasks.js";

const router = new Hono();

router.get("/", async (c) => {
  const queues = await getQueueSnapshots([taskQueue, agentTurnQueue, fsCdnQueue]);
  return c.json({ ok: true, queues });
});

export default router;
