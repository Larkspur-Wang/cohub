import { resolveHarness } from "@cohub/protocol";

/** Merge only adjacent cloud follow-ups with identical execution identity and configuration. */
export function selectCompatibleBatch<T extends { userUuid: string | null; meta: unknown }>(turns: T[]): T[] {
  const first = turns[0];
  if (!first) return [];
  if (resolveHarness(first.meta) !== "cohub") return [first];
  const key = (turn: T) => {
    const meta = turn.meta && typeof turn.meta === "object" ? turn.meta as Record<string, unknown> : {};
    return JSON.stringify([turn.userUuid, resolveHarness(meta), meta.provider, meta.model, meta.requestedThinkingLevel, meta.accessMode, meta.env, meta.context, meta.generationPolicy]);
  };
  const expected = key(first);
  const boundary = turns.findIndex((turn) => key(turn) !== expected);
  return boundary < 0 ? turns : turns.slice(0, boundary);
}
