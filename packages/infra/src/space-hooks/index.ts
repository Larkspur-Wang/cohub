import { createHash, randomUUID } from "node:crypto";
import {
  isSpaceHookableEvent,
  SPACE_HOOK_TASK_TYPE,
} from "@cohub/protocol";

export type SpaceHookEventEnvelope = {
  id: string;
  type: string;
  timestamp: number;
  spaceId: string;
  sessionId?: string | null;
  payload: Record<string, unknown>;
};

type TaskPayloadLike = {
  type: string;
  spaceId?: string;
  sessionId?: string;
  data?: Record<string, unknown>;
};

type TaskEnqueueOptions = { [key: string]: unknown; jobId?: string; delay?: number; scheduledAt?: Date | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveEventActorUserId(payload: Record<string, unknown>) {
  const actor = isRecord(payload.actor) ? payload.actor : null;
  return asString(actor?.userId)
    ?? asString(actor?.userUuid)
    ?? asString(payload.userId)
    ?? asString(payload.userUuid)
    ?? null;
}

export function buildSpaceHookTaskId(input: {
  spaceId: string;
  eventId: string;
  eventType: string;
}) {
  const digest = createHash("sha1")
    .update(`${input.spaceId}:${input.eventType}:${input.eventId}`)
    .digest("hex")
    .slice(0, 24);
  return `space-hook-${digest}`;
}

/**
 * Skip re-entrant hook triggers from hook-generated session activity.
 * A prompt hook that listens to session.turn.finalized would otherwise loop forever.
 */
export function isReentrantSpaceHookEvent(input: {
  type: string;
  payload?: Record<string, unknown> | null;
}): boolean {
  if (input.type !== "session.turn.finalized") return false;
  const payload = isRecord(input.payload) ? input.payload : null;
  const turn = isRecord(payload?.turn) ? payload.turn : null;
  const meta = isRecord(turn?.meta) ? turn.meta : null;
  if (!meta) return false;
  if (asString(meta.source) === "space_hook") return true;
  const context = isRecord(meta.context) ? meta.context : null;
  return asString(context?.kind) === "space_hook";
}

/**
 * Lightweight fan-out helper used by event publishers.
 * Only filters by hookable event type; all rigorous work happens in the job.
 */
export async function maybeEnqueueSpaceHookTask(input: {
  event: {
    id?: string | null;
    type: string;
    timestamp?: number;
    spaceId?: string | null;
    sessionId?: string | null;
    payload?: Record<string, unknown> | null;
  };
  enqueue: (name: string, payload: TaskPayloadLike, options: TaskEnqueueOptions) => Promise<unknown>;
}) {
  const spaceId = asString(input.event.spaceId);
  const type = asString(input.event.type);
  if (!spaceId || !type || !isSpaceHookableEvent(type)) return null;

  const payload = isRecord(input.event.payload) ? input.event.payload : {};
  if (isReentrantSpaceHookEvent({ type, payload })) return null;

  const event: SpaceHookEventEnvelope = {
    id: asString(input.event.id) ?? randomUUID(),
    type,
    timestamp: typeof input.event.timestamp === "number" ? input.event.timestamp : Date.now(),
    spaceId,
    sessionId: asString(input.event.sessionId),
    payload,
  };

  const taskPayload: TaskPayloadLike = {
    type: SPACE_HOOK_TASK_TYPE,
    spaceId,
    sessionId: event.sessionId ?? undefined,
    data: {
      event,
      eventActorUserId: resolveEventActorUserId(payload),
    },
  };

  try {
    const job = await input.enqueue(SPACE_HOOK_TASK_TYPE, taskPayload, {
      jobId: buildSpaceHookTaskId({
        spaceId,
        eventId: event.id,
        eventType: event.type,
      }),
    });
    return { job, event };
  } catch (error) {
    // Duplicate jobId is expected for retries/replays of the same event.
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|duplicat|JobId/i.test(message)) return null;
    throw error;
  }
}
