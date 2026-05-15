import { extractTrace, runInActiveSpan } from "@cohub/tracing/propagator";
import { getAgentTracer } from "@cohub/tracing/agent";
import { getAgentSessionFilePath, getAgentSpaceSessionsPath } from "./runtime/paths.js";
import { SessionManager } from "./runtime/local-session-manager.js";
import type { AgentSessionForkJobData } from "./queue.js";

const tracer = getAgentTracer();

export async function processSessionForkJob(data: AgentSessionForkJobData) {
  const parentCtx = extractTrace((data.trace ?? data) as Record<string, unknown>);
  return runInActiveSpan(tracer, "agent.session_fork.process", {
    attributes: {
      "cohub.space_id": data.spaceId,
      "cohub.session_id": data.sessionId,
      "agent.parent_session_id": data.parentSessionId,
      "agent.anchor_turn_id": data.anchorTurnId,
      "agent.anchor_sequence": data.anchorSequence,
      "agent.anchor_entry_id": data.anchorEntryId,
    },
  }, parentCtx, async () => {
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
  });
}
