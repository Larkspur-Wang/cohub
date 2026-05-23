import { QueueEvents } from "bullmq";
import { COHUB_AGENT_TURNS_QUEUE, createBullmqConnectionOptions } from "@cohub/infra/bullmq";
import {
  createAgentTurnsQueue,
  enqueueAgentRunCommandJob,
  type AgentRunCommandJobData,
  type AgentRunCommandJobResult,
} from "@cohub/infra/agent-queue";
import { RUN_COMMAND_TASK_TYPE, RUN_COMMAND_TIMEOUT_SECONDS, buildRunCommandQueuedProgress } from "@cohub/core/commands";
import type { Job } from "bullmq";
import type { TaskPayload } from "@cohub/protocol/task";
import { config } from "../config.js";
import { registerTask } from "./registry.js";

const agentQueue = createAgentTurnsQueue<AgentRunCommandJobData, AgentRunCommandJobResult>(config.bullmqRedisUrl, "cohub-worker-run-command");

function getJobId(job: Job) {
  if (!job.id) throw new Error("Task job has no id");
  return job.id;
}

async function mirrorAgentProgress(job: Job, agentJobId: string) {
  const agentJob = await agentQueue.getJob(agentJobId).catch(() => null);
  if (!agentJob) return;
  const progress = agentJob.progress;
  if (!progress) return;
  await job.updateProgress(progress).catch(() => undefined);
}

registerTask(RUN_COMMAND_TASK_TYPE, async (job) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  const data = payload.data ?? {};
  const command = typeof data.command === "string" ? data.command.trim() : "";
  const cwd = typeof data.cwd === "string" && data.cwd.trim() ? data.cwd.trim() : "/workspace";
  if (!spaceId) throw new Error("spaceId is required for run_command task");
  if (!command) throw new Error("command is required for run_command task");

  const taskRunId = getJobId(job);
  const agentJob = await enqueueAgentRunCommandJob(agentQueue, {
    spaceId,
    taskRunId,
    command,
    cwd,
    requestId: null,
  });

  await job.updateProgress(buildRunCommandQueuedProgress({
    toolCallId: `run-command-${taskRunId}`,
    command,
    cwd,
    output: "",
  })).catch(() => undefined);

  const queueEvents = new QueueEvents(COHUB_AGENT_TURNS_QUEUE, {
    connection: createBullmqConnectionOptions(config.bullmqRedisUrl),
  });
  await queueEvents.waitUntilReady();
  const mirrorTimer = setInterval(() => {
    void mirrorAgentProgress(job, agentJob.id ?? `run-command-${taskRunId}`);
  }, 600);

  try {
    const result = await agentJob.waitUntilFinished(queueEvents, (RUN_COMMAND_TIMEOUT_SECONDS + 60) * 1000) as AgentRunCommandJobResult;
    await mirrorAgentProgress(job, agentJob.id ?? `run-command-${taskRunId}`);
    return result;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearInterval(mirrorTimer);
    await queueEvents.close().catch(() => undefined);
  }
});
