import { Queue, type JobsOptions } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { env } from "./env.js";

export const AGENT_TURN_QUEUE_NAME = "cohub-agent-turns";
export const AGENT_TURN_JOB_NAME = "agent_turns";
export const AGENT_SESSION_FORK_JOB_NAME = "agent_session_fork";

export type AgentTurnJobData = {
  spaceId: string;
  sessionId: string;
  turnIds: string[];
  executionAuth?: { token: string; expiresAt: number } | null;
  trace?: Record<string, unknown>;
};

export type AgentSessionForkJobData = {
  spaceId: string;
  sessionId: string;
  parentSessionId: string;
  anchorTurnId: string;
  anchorSequence: number;
  anchorEntryId: string;
  trace?: Record<string, unknown>;
};

export type AgentJobData = AgentTurnJobData | AgentSessionForkJobData;

export const agentTurnQueue = new Queue<AgentJobData>(AGENT_TURN_QUEUE_NAME, {
  connection: { url: env.BULLMQ_REDIS_URL },
  telemetry: new BullMQOtel("cohub-agent"),
});

export async function enqueueAgentTurnJob(data: AgentTurnJobData, options: JobsOptions = {}) {
  const firstTurnId = data.turnIds[0];
  if (!firstTurnId) throw new Error("turnIds is required");
  return agentTurnQueue.add(AGENT_TURN_JOB_NAME, data, {
    jobId: `agent-turn:${firstTurnId}`,
    attempts: 2,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
    ...options,
  });
}

export async function enqueueAgentSessionForkJob(data: AgentSessionForkJobData, options: JobsOptions = {}) {
  return agentTurnQueue.add(AGENT_SESSION_FORK_JOB_NAME, data, {
    jobId: `agent-session-fork:${data.sessionId}:${data.anchorEntryId}`,
    attempts: 3,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
    ...options,
  });
}
