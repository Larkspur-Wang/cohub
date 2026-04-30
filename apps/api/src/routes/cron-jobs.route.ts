import { Hono } from "hono";
import { db } from "../db/index.js";
import { cronJobs, taskRuns } from "../db/schema-v2.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getOptionalAuth, useAuth, requireValidId } from "../lib/middleware.js";
import { getSpaceSessionById } from "../space-sessions.js";
import { hasPermission } from "../permissions.js";
import { createCronJob, disableCronJob, enableCronJob, removeCronJob, SUPPORTED_TASK_TYPES } from "../tasks.js";
import type { TaskScheduleConfig } from "@neta-art/cohub-protocol/task";
import * as cronParser from "cron-parser";

const { CronExpressionParser } = cronParser;

const router = new Hono();

router.post("/", async (c) => {
  const user = useAuth(c);

  const body = await c.req
    .json<{
      title: string;
      taskType: string;
      payload: Record<string, unknown>;
      cronExpression: string;
      timezone?: string;
      spaceId?: string;
      sessionId?: string;
    }>()
    .catch(() => null);

  if (!body?.title?.trim()) return c.json({ message: "title is required" }, 400);
  if (!body?.taskType) return c.json({ message: "taskType is required" }, 400);
  if (!SUPPORTED_TASK_TYPES.has(body.taskType)) return c.json({ message: "unsupported taskType" }, 400);
  if (!body?.cronExpression) return c.json({ message: "cronExpression is required" }, 400);
  if (body.spaceId && !requireValidId(body.spaceId)) return c.json({ message: "invalid spaceId" }, 400);
  if (body.sessionId && !requireValidId(body.sessionId)) return c.json({ message: "invalid sessionId" }, 400);

  let effectiveSpaceId = body.spaceId ?? null;
  if (body.sessionId) {
    const session = await getSpaceSessionById(body.sessionId);
    if (!session) return c.json({ message: "session not found" }, 404);
    effectiveSpaceId = effectiveSpaceId ?? session.spaceId;
    if (session.spaceId !== effectiveSpaceId) return c.json({ message: "session does not belong to space" }, 400);
  }
  if (effectiveSpaceId && !(await hasPermission(user, "cronjob.manage", { spaceId: effectiveSpaceId }))) return c.json({ message: "not found" }, 404);

  try {
    const interval = CronExpressionParser.parse(body.cronExpression, {
      tz: body.timezone ?? "Asia/Shanghai",
    });
    const nextRun = interval.next().toDate();
    const secondRun = interval.next().toDate();
    const intervalMs = secondRun.getTime() - nextRun.getTime();
    if (intervalMs < 60_000) {
      return c.json({ message: "cron interval must be at least 1 minute" }, 400);
    }
  } catch (parseError) {
    return c.json(
      { message: `invalid cron expression: ${parseError instanceof Error ? parseError.message : String(parseError)}` },
      400,
    );
  }

  const schedule: TaskScheduleConfig = {
    pattern: body.cronExpression,
    timezone: body.timezone,
  };

  try {
    const cronJob = await createCronJob({
      userId: user.uuid,
      title: body.title.trim(),
      taskType: body.taskType,
      payload: body.payload ?? {},
      schedule,
      spaceId: effectiveSpaceId,
      sessionId: body.sessionId ?? null,
    });

    return c.json(cronJob);
  } catch (error) {
    console.error("[CronJobs] Failed to create cron job:", error);
    return c.json(
      {
        message:
          "cron job was created, but scheduling failed; please check the job status and retry later",
      },
      500,
    );
  }
});

router.get("/", async (c) => {
  const spaceId = c.req.query("spaceId") ?? null;
  const user = spaceId ? getOptionalAuth(c) : useAuth(c);
  const userId = user?.uuid;

  if (spaceId && !requireValidId(spaceId)) return c.json({ message: "invalid spaceId" }, 400);

  if (spaceId) {
    if (!(await hasPermission(user, "cronjob.view", { spaceId }))) return c.json({ message: "not found" }, 404);
    const jobs = await db
      .select()
      .from(cronJobs)
      .where(and(eq(cronJobs.spaceId, spaceId), isNull(cronJobs.deletedAt)))
      .orderBy(desc(cronJobs.createdAt));
    return c.json({ jobs });
  }

  if (!userId) return c.json({ message: "unauthorized" }, 401);

  const jobs = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.userUuid, userId), isNull(cronJobs.deletedAt)))
    .orderBy(desc(cronJobs.createdAt));

  return c.json({ jobs });
});

router.get("/:id/runs", async (c) => {
  const user = getOptionalAuth(c);

  const cronJobId = c.req.param("id");
  if (!requireValidId(cronJobId)) return c.json({ message: "not found" }, 404);

  const [job] = await db
    .select({
      id: cronJobs.id,
      userUuid: cronJobs.userUuid,
      spaceId: cronJobs.spaceId,
      sessionId: cronJobs.sessionId,
    })
    .from(cronJobs)
    .where(and(eq(cronJobs.id, cronJobId), isNull(cronJobs.deletedAt)))
    .limit(1);
  if (!job) return c.json({ message: "not found" }, 404);

  if (job.spaceId) {
    if (!(await hasPermission(user, "taskrun.view", { spaceId: job.spaceId, sessionId: job.sessionId ?? undefined }))) {
      return c.json({ message: "not found" }, 404);
    }
  } else if (!user || job.userUuid !== user.uuid) {
    return c.json({ message: "not found" }, 404);
  }

  const runs = await db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.cronJobId, cronJobId))
    .orderBy(desc(taskRuns.createdAt))
    .limit(50);

  return c.json({ runs });
});

router.delete("/:id", async (c) => {
  const user = useAuth(c);

  const cronJobId = c.req.param("id");
  if (!requireValidId(cronJobId)) return c.json({ message: "not found" }, 404);

  const [job] = await db
    .select({
      id: cronJobs.id,
      userUuid: cronJobs.userUuid,
      spaceId: cronJobs.spaceId,
      sessionId: cronJobs.sessionId,
      bullJobKey: cronJobs.bullJobKey,
    })
    .from(cronJobs)
    .where(and(eq(cronJobs.id, cronJobId), isNull(cronJobs.deletedAt)))
    .limit(1);
  if (!job) return c.json({ message: "not found" }, 404);
  if (job.spaceId) {
    if (!(await hasPermission(user, "cronjob.manage", { spaceId: job.spaceId, sessionId: job.sessionId ?? undefined }))) {
      return c.json({ message: "not found" }, 404);
    }
  } else if (job.userUuid !== user.uuid) {
    return c.json({ message: "not found" }, 404);
  }

  await removeCronJob(cronJobId, job.bullJobKey);
  return c.json({ ok: true });
});

router.patch("/:id", async (c) => {
  const user = useAuth(c);

  const cronJobId = c.req.param("id");
  if (!requireValidId(cronJobId)) return c.json({ message: "not found" }, 404);

  const [job] = await db
    .select({
      id: cronJobs.id,
      userUuid: cronJobs.userUuid,
      spaceId: cronJobs.spaceId,
      sessionId: cronJobs.sessionId,
      enabled: cronJobs.enabled,
      bullJobKey: cronJobs.bullJobKey,
      taskType: cronJobs.taskType,
      payload: cronJobs.payload,
      cronExpression: cronJobs.cronExpression,
      timezone: cronJobs.timezone,
    })
    .from(cronJobs)
    .where(and(eq(cronJobs.id, cronJobId), isNull(cronJobs.deletedAt)))
    .limit(1);
  if (!job) return c.json({ message: "not found" }, 404);
  if (job.spaceId) {
    if (!(await hasPermission(user, "cronjob.manage", { spaceId: job.spaceId, sessionId: job.sessionId ?? undefined }))) {
      return c.json({ message: "not found" }, 404);
    }
  } else if (job.userUuid !== user.uuid) {
    return c.json({ message: "not found" }, 404);
  }

  const body = await c.req.json<{ enabled?: boolean }>().catch(() => null);
  if (body?.enabled === undefined) return c.json({ message: "enabled is required" }, 400);

  if (body.enabled && !job.enabled) {
    await enableCronJob(cronJobId, job.bullJobKey, {
      taskType: job.taskType,
      payload: job.payload as Record<string, unknown>,
      cronExpression: job.cronExpression,
      timezone: job.timezone,
      userUuid: job.userUuid,
      spaceId: job.spaceId,
      sessionId: job.sessionId,
    });
  } else if (!body.enabled && job.enabled) {
    await disableCronJob(cronJobId, job.bullJobKey);
  }

  return c.json({ ok: true });
});

export default router;
