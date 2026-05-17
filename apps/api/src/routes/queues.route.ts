import { exportQueuesPrometheusMetrics, getQueueSnapshots } from "@cohub/infra/bullmq";
import { Hono } from "hono";
import { agentTurnQueue } from "../agent-turn-queue.js";
import { fsCdnQueue } from "../space-fs-cdn-queue.js";
import { taskQueue } from "../tasks.js";

const router = new Hono();

router.get("/", async (c) => {
  const queues = await getQueueSnapshots([taskQueue, agentTurnQueue, fsCdnQueue]);
  return c.json({ ok: true, queues });
});

router.get("/metrics", async (c) => {
  const metrics = await exportQueuesPrometheusMetrics([taskQueue, agentTurnQueue, fsCdnQueue], {
    includeQueueDefinitionLabels: true,
  });
  return c.text(metrics, 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

export default router;
