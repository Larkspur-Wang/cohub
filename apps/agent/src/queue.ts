import { COHUB_AGENT_TURNS_QUEUE, createBullmqQueue } from "@cohub/infra/bullmq";
import type { JobsOptions } from "bullmq";
import { env } from "./env.js";

export const AGENT_TURN_QUEUE_NAME = COHUB_AGENT_TURNS_QUEUE;
export const AGENT_TURN_JOB_NAME = "agent_turns";
export const AGENT_SESSION_FORK_JOB_NAME = "agent_session_fork";
export const AGENT_SANDBOX_BASH_JOB_NAME = "sandbox_bash";

export type AgentTurnJobData = {
  spaceId: string;
  sessionId: string;
  turnIds: string[];
  executionAuth?: { token: string; expiresAt: number } | null;
  requestId?: string | null;
  trace?: Record<string, unknown>;
};

export type AgentSessionForkJobData = {
  spaceId: string;
  sessionId: string;
  parentSessionId: string;
  anchorTurnId: string;
  anchorSequence: number;
  anchorEntryId: string;
  requestId?: string | null;
  trace?: Record<string, unknown>;
};

export type SandboxBashUploadFile = {
  relativePath: string;
  name: string;
  size: number;
  mimeType: string | null;
  downloadUrl: string;
};

export type SandboxBashUploadJobData = {
  spaceId: string;
  sessionId: string;
  uploadId: string;
  destinationRoot: string;
  downloadHost: string;
  files: SandboxBashUploadFile[];
  requestId?: string | null;
  trace?: Record<string, unknown>;
};

export type AgentJobData = AgentTurnJobData | AgentSessionForkJobData | SandboxBashUploadJobData;

export const agentTurnQueue = createBullmqQueue<AgentJobData>(AGENT_TURN_QUEUE_NAME, {
  redisUrl: env.BULLMQ_REDIS_URL,
  telemetryServiceName: "cohub-agent",
});

export async function enqueueAgentTurnJob(data: AgentTurnJobData, options: JobsOptions = {}) {
  const firstTurnId = data.turnIds[0];
  if (!firstTurnId) throw new Error("turnIds is required");
  return agentTurnQueue.add(AGENT_TURN_JOB_NAME, data, {
    jobId: `agent-turn-${firstTurnId}`,
    attempts: 2,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
    ...options,
  });
}

export async function enqueueAgentSessionForkJob(data: AgentSessionForkJobData, options: JobsOptions = {}) {
  return agentTurnQueue.add(AGENT_SESSION_FORK_JOB_NAME, data, {
    jobId: `agent-session-fork-${data.sessionId}-${data.anchorEntryId}`,
    attempts: 3,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
    ...options,
  });
}

export async function enqueueSandboxBashJob(data: SandboxBashUploadJobData, options: JobsOptions = {}) {
  return agentTurnQueue.add(AGENT_SANDBOX_BASH_JOB_NAME, data, {
    jobId: `sandbox-bash-${data.uploadId}`,
    attempts: 2,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
    ...options,
  });
}
