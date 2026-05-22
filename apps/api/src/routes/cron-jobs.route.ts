import { Hono } from "hono";
import { db } from "../db/index.js";
import { cronJobs, taskRuns } from "@cohub/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getOptionalAuth, useAuth, requireValidId, authzDenied } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { disableCronJob, enableCronJob, removeCronJob } from "../tasks.js";
import { fallbackPublicUserProfile, getProfilesByUuids } from "../user-profiles.js";

const router = new Hono();

async function hydrateCronJobUserProfiles<T extends { userUuid: string }>(jobs: T[]) {
  const profiles = await getProfilesByUuids(jobs.map((job) => job.userUuid));
  return jobs.map((job) => ({
    ...job,
    userProfile: profiles.get(job.userUuid) ?? fallbackPublicUserProfile(job.userUuid),
  }));
}

router.get("/", async (c) => {
  const spaceId = c.req.query("spaceId") ?? null;
  const user = spaceId ? getOptionalAuth(c) : useAuth(c);
  const userId = user?.uuid;

  if (spaceId && !requireValidId(spaceId)) return c.json({ message: "invalid spaceId" }, 400);

  if (spaceId) {
    if (!(await hasPermission(user, "cronjob.view", { spaceId }))) return authzDenied(c);
    const jobs = await db
      .select()
      .from(cronJobs)
      .where(and(eq(cronJobs.spaceId, spaceId), isNull(cronJobs.deletedAt)))
      .orderBy(desc(cronJobs.createdAt));
    return c.json({ jobs: await hydrateCronJobUserProfiles(jobs) });
  }

  if (!userId) return c.json({ message: "unauthorized" }, 401);

  const jobs = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.userUuid, userId), isNull(cronJobs.deletedAt)))
    .orderBy(desc(cronJobs.createdAt));

  return c.json({ jobs: await hydrateCronJobUserProfiles(jobs) });
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
      return authzDenied(c);
    }
  } else if (!user || job.userUuid !== user.uuid) {
    return authzDenied(c);
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
      return authzDenied(c);
    }
  } else if (job.userUuid !== user.uuid) {
    return authzDenied(c);
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
      return authzDenied(c);
    }
  } else if (job.userUuid !== user.uuid) {
    return authzDenied(c);
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
