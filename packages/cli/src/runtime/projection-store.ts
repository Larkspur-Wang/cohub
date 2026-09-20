import { fingerprintProjectionTurns, HttpError, isProjectionCompaction, type NativeProjection, type ProjectionTarget } from "@neta-art/cohub";
import { getSessionProjectionTurn, listSessionProjectionTurns, projectTurnBatch, type ProjectionSourceTurn, type SessionTurnProjectionClient } from "./turn-projection.js";

export type ProjectionCursorState = {
  throughSequence: number | null;
  throughTurnId: string | null;
  sourceFingerprint: string | null;
};

export type ProjectionStoreInput = {
  spaceId: string;
  sessionId: string;
  turnId: string;
  nativeSessionId: string;
  cwd: string;
  provider?: string | null;
  target: ProjectionTarget;
  throughTurnId: string | null;
  cursor: ProjectionCursorState | null;
};

export type ProjectionStoreResult = {
  projection: NativeProjection;
  turns: ProjectionSourceTurn[];
  append: boolean;
  cursor: ProjectionCursorState;
};

export function rebindProjectionNativeSession(result: ProjectionStoreResult, nativeSessionId: string): ProjectionStoreResult {
  if (result.append) return result;
  const records = result.projection.records.map((entry) => {
    if (entry.sourceTurnId !== null) return entry;
    if (entry.record.type === "session") {
      return { ...entry, record: { ...entry.record, id: nativeSessionId, affinity: { ...(entry.record.affinity as Record<string, unknown>), threadId: nativeSessionId } } };
    }
    if (entry.record.type === "session_meta") {
      const payload = entry.record.payload as Record<string, unknown>;
      return { ...entry, record: { ...entry.record, payload: { ...payload, id: nativeSessionId, session_id: nativeSessionId } } };
    }
    return entry;
  });
  return { ...result, projection: { ...result.projection, records } };
}

/** Reads durable Cohub turns and materializes one harness-specific native projection batch. */
export class ProjectionStore {
  constructor(private readonly source: SessionTurnProjectionClient) {}

  async project(input: ProjectionStoreInput, signal?: AbortSignal): Promise<ProjectionStoreResult> {
    const throughSequence = input.throughTurnId ? await this.sourceSequence(input.sessionId, input.throughTurnId, signal) : 0;
    let source = await this.readTurns(input, throughSequence, signal);
    if (source.append && source.turns.some((turn) => turn.messages.some(isProjectionCompaction))) {
      source = { turns: await listSessionProjectionTurns(this.source, input.sessionId, { throughSequence, excludeTurnId: input.turnId, signal }), append: false };
    }
    const projection = projectTurnBatch({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      nativeSessionId: input.nativeSessionId,
      cwd: input.cwd,
      provider: input.provider,
      turns: source.turns,
    }, input.target, !source.append);
    const last = source.turns.at(-1);
    const previous = source.append ? input.cursor : null;
    return {
      projection,
      turns: source.turns,
      append: source.append,
      cursor: {
        throughSequence: last?.sequence ?? previous?.throughSequence ?? null,
        throughTurnId: last?.sourceTurnId ?? previous?.throughTurnId ?? null,
        sourceFingerprint: last ? fingerprintProjectionTurns([last]) : previous?.sourceFingerprint ?? null,
      },
    };
  }

  private async sourceSequence(sessionId: string, turnId: string, signal?: AbortSignal): Promise<number> {
    const client = this.source.session(sessionId);
    const response = await client.turns.get(turnId, { signal });
    return response.turn.sequence;
  }

  async cursorForTurn(sessionId: string, turnId: string, signal?: AbortSignal): Promise<ProjectionCursorState> {
    const turn = await getSessionProjectionTurn(this.source, sessionId, turnId, signal);
    return {
      throughSequence: turn.sequence,
      throughTurnId: turn.sourceTurnId,
      sourceFingerprint: fingerprintProjectionTurns([turn]),
    };
  }

  private async readTurns(input: ProjectionStoreInput, throughSequence: number, signal?: AbortSignal): Promise<{ turns: ProjectionSourceTurn[]; append: boolean }> {
    const cursor = input.cursor;
    if (cursor?.throughSequence != null && cursor.throughSequence > throughSequence) {
      return { turns: await listSessionProjectionTurns(this.source, input.sessionId, { throughSequence, excludeTurnId: input.turnId, signal }), append: false };
    }
    if (cursor?.throughTurnId && cursor.throughSequence != null) {
      let anchor: ProjectionSourceTurn | null;
      try {
        anchor = await getSessionProjectionTurn(this.source, input.sessionId, cursor.throughTurnId, signal);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
        anchor = null;
      }
      const anchorFingerprint = anchor ? fingerprintProjectionTurns([anchor]) : null;
      if (anchorFingerprint !== cursor.sourceFingerprint) {
        return {
          turns: await listSessionProjectionTurns(this.source, input.sessionId, { throughSequence, excludeTurnId: input.turnId, signal }),
          append: false,
        };
      }
      return {
        turns: await listSessionProjectionTurns(this.source, input.sessionId, {
          afterSequence: Math.max(1, cursor.throughSequence),
          throughSequence,
          excludeTurnId: input.turnId,
          signal,
        }),
        append: true,
      };
    }
    return {
      turns: await listSessionProjectionTurns(this.source, input.sessionId, { throughSequence, excludeTurnId: input.turnId, signal }),
      append: false,
    };
  }
}
