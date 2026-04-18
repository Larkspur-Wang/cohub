import { AsyncLocalStorage } from "node:async_hooks";

export type ToolExecutionContext = {
  spaceId: string;
  sessionId: string;
};

const storage = new AsyncLocalStorage<ToolExecutionContext>();

export function runWithToolExecutionContext<T>(
  ctx: ToolExecutionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getCurrentToolExecutionContext(): ToolExecutionContext | null {
  return storage.getStore() ?? null;
}
