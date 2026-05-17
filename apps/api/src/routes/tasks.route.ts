import { Hono } from "hono";
import { db } from "../db/index.js";
import { taskRuns } from "@cohub/db";
import { eq, and, desc } from "drizzle-orm";
import { getOptionalAuth, useAuth, requireValidId } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { taskQueue } from "../tasks.js";

const router = new Hono();

router.get("/", async (c) => {
  const cronJobId = c.req.query("cronJobId");
  const spaceId = c.req.query("spaceId");
  const user = spaceId ? getOptionalAuth(c) : useAuth(c);
  const userId = user?.uuid;

  if (spaceId && !requireValidId(spaceId)) return c.json({ message: "invalid spaceId" }, 400);
  if (cronJobId && !requireValidId(cronJobId)) return c.json({ message: "invalid cronJobId" }, 400);

  if (spaceId) {
    if (!(await hasPermission(user, "taskrun.view", { spaceId }))) return c.json({ message: "not found" }, 404);
    const conditions = [eq(taskRuns.spaceId, spaceId)];
    if (cronJobId) conditions.push(eq(taskRuns.cronJobId, cronJobId));
    const runs = await db
      .select()
      .from(taskRuns)
      .where(and(...conditions))
      .orderBy(desc(taskRuns.createdAt))
      .limit(50);
    return c.json({ runs });
  }

  if (!userId) return c.json({ message: "unauthorized" }, 401);

  const runs = await db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.userUuid, userId))
    .orderBy(desc(taskRuns.createdAt))
    .limit(50);

  return c.json({ runs });
});

router.get("/:taskId", async (c) => {
  const user = getOptionalAuth(c);

  const taskId = c.req.param("taskId");
  if (!taskId?.trim()) return c.json({ message: "task run not found" }, 404);

  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, taskId)).limit(1);
  if (!run) return c.json({ message: "task run not found" }, 404);

  if (run.spaceId) {
    if (!(await hasPermission(user, "taskrun.view", { spaceId: run.spaceId, sessionId: run.sessionId ?? undefined }))) {
      return c.json({ message: "task run not found" }, 404);
    }
  } else if (!user || run.userUuid !== user.uuid) {
    return c.json({ message: "task run not found" }, 404);
  }

  const job = await taskQueue.getJob(run.jobId).catch(() => null);
  return c.json({ run, progress: job?.progress ?? null });
});

export default router;
