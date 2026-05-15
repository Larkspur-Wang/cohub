import { COHUB_TASKS_QUEUE, createBullmqRedisConnection } from "@cohub/bullmq-ops";
import { Queue, type JobsOptions } from "bullmq";
import type { TaskPayload } from "@neta-art/cohub-protocol/task";

const redisUrl = process.env.BULLMQ_REDIS_URL ?? "redis://localhost:6379/3";

const createQueue = () => {
  const connection = createBullmqRedisConnection(redisUrl);
  return new Queue(COHUB_TASKS_QUEUE, { connection });
};

/**
 * Manually enqueue a task (bypasses cron).
 * Used for dev/testing — the Worker picks it up and processes it normally.
 */
export const triggerTask = async (
  payload: TaskPayload,
  opts?: JobsOptions,
) => {
  const queue = createQueue();
  const job = await queue.add(payload.type, payload, {
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 1,
    ...opts,
  });
  console.log(`✅ Task enqueued: type=${payload.type}, jobId=${job.id}`);
  await queue.close();
  return job;
};

/**
 * List all currently scheduled repeatable jobs.
 */
export const listScheduled = async () => {
  const queue = createQueue();
  const jobs = await queue.getRepeatableJobs();
  if (jobs.length === 0) {
    console.log("No scheduled jobs.");
  } else {
    console.table(jobs.map(j => ({
      key: j.key,
      name: j.name,
      pattern: j.pattern,
      tz: j.tz,
      next: j.next ? new Date(j.next).toLocaleString() : "-",
    })));
  }
  await queue.close();
  return jobs;
};

// ─── CLI entry point ───

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case "trigger": {
      const [type, json] = process.argv.slice(3);
      if (!type) {
        console.error("Usage: trigger <type> '<json-payload>'");
        process.exit(1);
      }
      const data = json ? (JSON.parse(json) as Record<string, unknown>) : {};
      const payload: TaskPayload = { type, ...data };
      await triggerTask(payload);
      break;
    }

    case "list-scheduled": {
      await listScheduled();
      break;
    }

    default:
      console.log("Available commands:");
      console.log("  trigger <type> '<json>'      — Enqueue arbitrary task");
      console.log("  list-scheduled               — List cron jobs");
      process.exit(1);
  }
}
