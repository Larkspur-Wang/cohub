import type { AssistantMessage } from "@earendil-works/pi-ai";

export const TOOL_CALL_LOOP_GUARD_THRESHOLD = 5;
export const TOOL_CALL_LOOP_GUARD_PROMPT = "You are repeating the same tool call. Stop and reassess the task.";

export type ToolCallLoopGuardState = {
  turnId: string | null;
  fingerprint: string | null;
  repeatCount: number;
};

export const EMPTY_TOOL_CALL_LOOP_GUARD_STATE: ToolCallLoopGuardState = {
  turnId: null,
  fingerprint: null,
  repeatCount: 0,
};

function stableSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nestedValue]) => nestedValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`).join(",")}}`;
}

export function getToolCallBatchFingerprint(message: AssistantMessage): string | null {
  const calls = (Array.isArray(message.content) ? message.content : [])
    .filter((block) => block.type === "toolCall")
    .map((block) => stableSerialize({ name: block.name, arguments: block.arguments }))
    .sort();

  return calls.length > 0 ? stableSerialize(calls) : null;
}

export function observeToolCallBatch(
  state: ToolCallLoopGuardState,
  input: { turnId: string | null; message: AssistantMessage },
): { state: ToolCallLoopGuardState; shouldIntervene: boolean } {
  const fingerprint = getToolCallBatchFingerprint(input.message);
  if (!fingerprint) {
    return {
      state: { turnId: input.turnId, fingerprint: null, repeatCount: 0 },
      shouldIntervene: false,
    };
  }

  const repeatCount = state.turnId === input.turnId && state.fingerprint === fingerprint
    ? state.repeatCount + 1
    : 1;
  if (repeatCount < TOOL_CALL_LOOP_GUARD_THRESHOLD) {
    return {
      state: { turnId: input.turnId, fingerprint, repeatCount },
      shouldIntervene: false,
    };
  }

  return {
    state: { turnId: input.turnId, fingerprint: null, repeatCount: 0 },
    shouldIntervene: true,
  };
}
