import { AsyncLocalStorage } from "node:async_hooks";

export type RequestTraceContext = {
  requestId?: string | null;
  traceId?: string | null;
};

const storage = new AsyncLocalStorage<RequestTraceContext>();

export function runWithRequestTraceContext<T>(ctx: RequestTraceContext, fn: () => Promise<T>): Promise<T> {
  const current = storage.getStore();
  return storage.run({ ...(current ?? {}), ...ctx }, fn);
}

export function getRequestTraceContext(): RequestTraceContext | null {
  return storage.getStore() ?? null;
}
