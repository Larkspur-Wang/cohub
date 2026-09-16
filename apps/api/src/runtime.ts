import { createLogger } from "@cohub/infra/logging";
import { runtimeRegistrationKey, parseRuntimeRegistration, type RuntimeRegistration } from "@cohub/protocol";
import { redisCommandClient } from "./redis.js";
import { listRuntimeRecoveryTurns, runtimeRecoverySnapshot, readRuntimeRecovery } from "@cohub/core/sessions";
import { enqueueRuntimeRecovery } from "@cohub/infra/agent-queue";
import type { RuntimeStopConfirmation } from "@cohub/protocol";
import { db } from "./db/index.js";
import { agentTurnQueue } from "./agent-turn-queue.js";

const logger = createLogger({ serviceName: "cohub-api" });

export async function getRuntimeRegistration(spaceId: string): Promise<RuntimeRegistration | null> {
  const raw = await redisCommandClient.get(runtimeRegistrationKey(spaceId));
  if (!raw) return null;
  const record = parseRuntimeRegistration(raw);
  if (!record) logger.warn("[Runtime] ignoring invalid registration", { spaceId });
  return record;
}

export async function getRuntimeRecovery(spaceId: string) {
  return runtimeRecoverySnapshot(await listRuntimeRecoveryTurns(db, spaceId));
}

export async function confirmRuntimeStopped(spaceId: string, actorUserId: string, request: RuntimeStopConfirmation) {
  const turns = await listRuntimeRecoveryTurns(db, spaceId);
  const snapshot = runtimeRecoverySnapshot(turns);
  if (request.revision !== snapshot.revision) return false;
  if (snapshot.pending) await enqueueRuntimeRecovery(agentTurnQueue, { spaceId, confirmation: { actorUserId, revision: snapshot.revision, turnIds: turns.filter((turn) => readRuntimeRecovery(turn.meta)?.state === "attention").map((turn) => turn.id) } });
  return true;
}
