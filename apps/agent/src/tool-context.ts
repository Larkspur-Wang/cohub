import { AsyncLocalStorage } from "node:async_hooks";

export type TurnTelemetryMetrics = {
  llmRoundCount: number;
  toolCallCount: number;
};

export type ToolExecutionContext = {
  spaceId: string;
  sessionId: string;
  turnId?: string;
  turnSeq?: number;
  llmRound?: number;
  toolCallId?: string;
  metrics?: TurnTelemetryMetrics;
};

const storage = new AsyncLocalStorage<ToolExecutionContext>();

export function runWithToolExecutionContext<T>(
  ctx: ToolExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  const current = storage.getStore();
  return storage.run({ ...(current ?? {}), ...ctx }, fn);
}

export function getCurrentToolExecutionContext(): ToolExecutionContext | null {
  return storage.getStore() ?? null;
}
