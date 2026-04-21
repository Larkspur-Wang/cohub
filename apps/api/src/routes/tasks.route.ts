import { Hono } from "hono";
import { db } from "../db/index.js";
import { taskRuns } from "../db/schema-v2.js";
import { eq, and, desc } from "drizzle-orm";
import { useAuth, requireValidId } from "../lib/middleware.js";
import { getSpaceSessionById } from "../space-sessions.js";
import { canWrite } from "../permissions.js";
import { enqueueTask, SUPPORTED_TASK_TYPES } from "../tasks.js";

const router = new Hono();

router.post("/", async (c) => {
  const user = useAuth(c);

  const body = await c.req
    .json<{
      taskType: string;
      payload: Record<string, unknown>;
      scheduleAt: string;
      spaceId?: string;
      sessionId?: string;
    }>()
    .catch(() => null);

  if (!body?.taskType) return c.json({ message: "taskType is required" }, 400);
  if (!SUPPORTED_TASK_TYPES.has(body.taskType)) return c.json({ message: "unsupported taskType" }, 400);
  if (!body?.scheduleAt) return c.json({ message: "scheduleAt is required" }, 400);
  if (body.spaceId && !requireValidId(body.spaceId)) return c.json({ message: "invalid spaceId" }, 400);
  if (body.sessionId && !requireValidId(body.sessionId)) return c.json({ message: "invalid sessionId" }, 400);

  let effectiveSpaceId = body.spaceId ?? null;
  if (body.sessionId) {
    const session = await getSpaceSessionById(body.sessionId);
    if (!session) return c.json({ message: "session not found" }, 404);
    effectiveSpaceId = effectiveSpaceId ?? session.spaceId;
    if (session.spaceId !== effectiveSpaceId) return c.json({ message: "session does not belong to space" }, 400);
  }
  if (effectiveSpaceId && !(await canWrite(user, effectiveSpaceId))) return c.json({ message: "not found" }, 404);

  const scheduledTime = new Date(body.scheduleAt);
  if (Number.isNaN(scheduledTime.getTime())) {
    return c.json({ message: "invalid scheduleAt, must be a valid ISO 8601 datetime" }, 400);
  }

  const delay = scheduledTime.getTime() - Date.now();
  if (delay < 0) {
    return c.json({ message: "scheduleAt must be in the future" }, 400);
  }

  try {
    const { taskRunId } = await enqueueTask(
      {
        type: body.taskType,
        spaceId: effectiveSpaceId ?? undefined,
        sessionId: body.sessionId ?? undefined,
        userId: user.uuid,
        data: body.payload ?? {},
      },
      { delay, scheduledAt: scheduledTime },
    );

    return c.json({ ok: true, taskRunId, scheduledAt: scheduledTime.toISOString() });
  } catch (error) {
    console.error("[Tasks] Failed to schedule task:", error);
    return c.json({ message: "failed to schedule task" }, 500);
  }
});

router.get("/", async (c) => {
  const user = useAuth(c);

  const cronJobId = c.req.query("cronJobId");
  const spaceId = c.req.query("spaceId");

  const conditions = [eq(taskRuns.userUuid, user.uuid)];
  if (cronJobId && requireValidId(cronJobId)) conditions.push(eq(taskRuns.cronJobId, cronJobId));
  if (spaceId && requireValidId(spaceId)) conditions.push(eq(taskRuns.spaceId, spaceId));

  const runs = await db
    .select()
    .from(taskRuns)
    .where(and(...conditions))
    .orderBy(desc(taskRuns.createdAt))
    .limit(50);

  return c.json({ runs });
});

router.get("/:taskId", async (c) => {
  const user = useAuth(c);

  const taskId = c.req.param("taskId");
  if (!taskId?.trim()) return c.json({ message: "task run not found" }, 404);

  const [run] = await db
    .select()
    .from(taskRuns)
    .where(and(eq(taskRuns.userUuid, user.uuid), eq(taskRuns.id, taskId)))
    .limit(1);

  if (!run) return c.json({ message: "task run not found" }, 404);
  return c.json({ run });
});

export default router;
