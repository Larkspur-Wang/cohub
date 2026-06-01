import { recordJobFailure } from "@cohub/infra/bullmq";
import { extractTrace, runInActiveSpan } from "@cohub/infra/tracing/propagator";
import { getAgentTracer } from "@cohub/infra/tracing/agent";
import { getAgentSessionFilePath, getAgentSpaceSessionsPath } from "./runtime/paths.js";
import { SessionManager } from "./runtime/local-session-manager.js";
import type { AgentSessionForkJobData } from "./queue.js";

const tracer = getAgentTracer();

export async function processSessionForkJob(job: import("bullmq").Job<AgentSessionForkJobData>) {
  const data = job.data;
  const queueWaitMs = getQueueWaitMs(job);
  const parentCtx = extractTrace((data.trace ?? data) as Record<string, unknown>);
  return runInActiveSpan(tracer, "agent.session_fork.process", {
    attributes: {
      "cohub.request_id": data.requestId ?? "",
      "cohub.space_id": data.spaceId,
      "cohub.session_id": data.sessionId,
      "agent.parent_session_id": data.parentSessionId,
      "agent.anchor_turn_id": data.anchorTurnId,
      "agent.anchor_sequence": data.anchorSequence,
      "agent.anchor_entry_id": data.anchorEntryId,
      "job.id": job.id ?? "",
      "job.attempt": job.attemptsMade ?? 0,
      ...(job.timestamp ? { "agent.queue.enqueued_at_ms": job.timestamp } : {}),
      ...(job.processedOn ? { "agent.queue.processed_on_ms": job.processedOn } : {}),
      ...(job.delay ? { "agent.queue.delay_ms": job.delay } : {}),
      ...(queueWaitMs != null ? { "agent.queue.wait_ms": queueWaitMs } : {}),
    },
  }, parentCtx, async () => {
    try {
      const parentSessionFile = getAgentSessionFilePath(data.spaceId, data.parentSessionId);
      const childSessionFile = getAgentSessionFilePath(data.spaceId, data.sessionId);
      const sessionsDir = getAgentSpaceSessionsPath(data.spaceId);
      const parentManager = await SessionManager.open(parentSessionFile, sessionsDir);
      const branchFile = await parentManager.createBranchedSession(data.anchorEntryId, {
        id: data.sessionId,
        filePath: childSessionFile,
        parentSession: parentSessionFile,
      });
      if (!branchFile) throw new Error("Failed to create forked session file");
      return { sessionId: data.sessionId, branchFile };
    } catch (error) {
      await recordJobFailure(job, error, {
        reason: "session_fork_failed",
        meta: {
          spaceId: data.spaceId,
          sessionId: data.sessionId,
          parentSessionId: data.parentSessionId,
          anchorTurnId: data.anchorTurnId,
          anchorEntryId: data.anchorEntryId,
        },
      });
      throw error;
    }
  });
}

function getQueueWaitMs(job: { timestamp?: number; processedOn?: number }) {
  if (!job.timestamp) return null;
  const processedAt = job.processedOn && job.processedOn >= job.timestamp ? job.processedOn : Date.now();
  return Math.max(0, processedAt - job.timestamp);
}
