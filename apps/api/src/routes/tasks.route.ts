import { Hono } from "hono";
import { db } from "../db/index.js";
import { taskRuns } from "@cohub/db";
import { eq, and, desc, inArray, lt, or } from "drizzle-orm";
import { getOptionalAuth, useAuth, requireValidId, authzDenied } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { taskQueue } from "../tasks.js";

const router = new Hono();

function parseTaskCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [createdAtRaw, id] = cursor.split("|");
  const createdAt = new Date(createdAtRaw ?? "");
  if (Number.isNaN(createdAt.getTime())) return "invalid" as const;
  return { createdAt, id: id?.trim() || null };
}

function buildTaskCursor(run: { createdAt: Date | string | null; id: string } | undefined) {
  if (!run?.createdAt) return null;
  const createdAt = run.createdAt instanceof Date ? run.createdAt.toISOString() : run.createdAt;
  return `${createdAt}|${run.id}`;
}

function applyTaskFilters(input: {
  conditions: ReturnType<typeof eq>[];
  sessionId?: string;
  cronJobId?: string;
  taskType?: string;
  status?: string;
  cursor: ReturnType<typeof parseTaskCursor>;
}) {
  if (input.sessionId) input.conditions.push(eq(taskRuns.sessionId, input.sessionId));
  if (input.cronJobId) input.conditions.push(eq(taskRuns.cronJobId, input.cronJobId));
  if (input.taskType?.trim()) input.conditions.push(eq(taskRuns.taskType, input.taskType.trim()));
  if (input.status === "active") input.conditions.push(inArray(taskRuns.status, ["pending", "running"]));
  else if (input.status) input.conditions.push(eq(taskRuns.status, input.status));
  if (input.cursor && input.cursor !== "invalid") {
    const cursorCondition = input.cursor.id
      ? or(lt(taskRuns.createdAt, input.cursor.createdAt), and(eq(taskRuns.createdAt, input.cursor.createdAt), lt(taskRuns.id, input.cursor.id)))
      : lt(taskRuns.createdAt, input.cursor.createdAt);
    if (cursorCondition) input.conditions.push(cursorCondition);
  }
}

router.get("/", async (c) => {
  const cronJobId = c.req.query("cronJobId");
  const spaceId = c.req.query("spaceId");
  const sessionId = c.req.query("sessionId");
  const taskType = c.req.query("taskType");
  const status = c.req.query("status");
  const cursor = c.req.query("cursor");
  const limitParam = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 100) : 50;
  const user = spaceId ? getOptionalAuth(c) : useAuth(c);
  const userId = user?.uuid;

  if (spaceId && !requireValidId(spaceId)) return c.json({ message: "invalid spaceId" }, 400);
  if (sessionId && !requireValidId(sessionId)) return c.json({ message: "invalid sessionId" }, 400);
  if (cronJobId && !requireValidId(cronJobId)) return c.json({ message: "invalid cronJobId" }, 400);
  if (status && !["active", "pending", "running", "completed", "failed"].includes(status)) {
    return c.json({ message: "invalid status" }, 400);
  }
  const cursorValue = parseTaskCursor(cursor);
  if (cursorValue === "invalid") return c.json({ message: "invalid cursor" }, 400);

  if (spaceId) {
    if (!(await hasPermission(user, "taskrun.view", { spaceId, sessionId: sessionId ?? undefined }))) return authzDenied(c);
    const conditions = [eq(taskRuns.spaceId, spaceId)];
    applyTaskFilters({ conditions, sessionId, cronJobId, taskType, status, cursor: cursorValue });
    const rows = await db
      .select()
      .from(taskRuns)
      .where(and(...conditions))
      .orderBy(desc(taskRuns.createdAt), desc(taskRuns.id))
      .limit(limit + 1);
    const runs = rows.slice(0, limit);
    return c.json({ runs, pageInfo: { hasMore: rows.length > limit, nextCursor: rows.length > limit ? buildTaskCursor(runs.at(-1)) : null } });
  }

  if (!userId) return c.json({ message: "unauthorized" }, 401);

  const conditions = [eq(taskRuns.userUuid, userId)];
  applyTaskFilters({ conditions, sessionId, cronJobId, taskType, status, cursor: cursorValue });
  const rows = await db
    .select()
    .from(taskRuns)
    .where(and(...conditions))
    .orderBy(desc(taskRuns.createdAt), desc(taskRuns.id))
    .limit(limit + 1);
  const runs = rows.slice(0, limit);

  return c.json({ runs, pageInfo: { hasMore: rows.length > limit, nextCursor: rows.length > limit ? buildTaskCursor(runs.at(-1)) : null } });
});

router.get("/:taskId", async (c) => {
  const user = getOptionalAuth(c);

  const taskId = c.req.param("taskId");
  if (!taskId?.trim()) return c.json({ message: "task run not found" }, 404);

  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, taskId)).limit(1);
  if (!run) return c.json({ message: "task run not found" }, 404);

  if (run.spaceId) {
    if (!(await hasPermission(user, "taskrun.view", { spaceId: run.spaceId, sessionId: run.sessionId ?? undefined }))) {
      return authzDenied(c);
    }
  } else if (!user || run.userUuid !== user.uuid) {
    return authzDenied(c);
  }

  const job = await taskQueue.getJob(run.jobId).catch(() => null);
  return c.json({ run, progress: job?.progress ?? null });
});

export default router;
