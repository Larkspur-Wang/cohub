import type { AgentTurnAbortEvent } from "./abort.js";

export type ActiveAbortHandle = {
  id: string;
  kind: "turn" | "tool";
  toolName?: string;
  abort: () => void | Promise<void>;
};

const ABORT_EVENT_TTL_MS = 10 * 60 * 1000;
const activeAbortControllers = new Map<string, Set<AbortController>>();
const activeAbortHandles = new Map<string, Map<string, ActiveAbortHandle>>();
const activeAbortEvents = new Map<string, AgentTurnAbortEvent>();
const activeAbortEventTimers = new Map<string, ReturnType<typeof setTimeout>>();

function abortController(controller: AbortController) {
  if (controller.signal.aborted) return false;
  controller.abort();
  return true;
}

function abortHandle(handle: ActiveAbortHandle) {
  void Promise.resolve(handle.abort()).catch(() => undefined);
}

export function getActiveAbortControllers(turnId: string) {
  return activeAbortControllers.get(turnId) ?? null;
}

export function setActiveAbortController(turnId: string, controller: AbortController) {
  const controllers = activeAbortControllers.get(turnId) ?? new Set<AbortController>();
  controllers.add(controller);
  activeAbortControllers.set(turnId, controllers);
  if (activeAbortEvents.has(turnId)) abortController(controller);
}

export function clearActiveAbortController(turnId: string, controller: AbortController) {
  const controllers = activeAbortControllers.get(turnId);
  if (!controllers) return;
  controllers.delete(controller);
  if (controllers.size === 0) activeAbortControllers.delete(turnId);
}

export function registerActiveAbortHandle(turnId: string, handle: ActiveAbortHandle) {
  const handles = activeAbortHandles.get(turnId) ?? new Map<string, ActiveAbortHandle>();
  handles.set(handle.id, handle);
  activeAbortHandles.set(turnId, handles);
  if (activeAbortEvents.has(turnId)) abortHandle(handle);
  return () => {
    const current = activeAbortHandles.get(turnId);
    if (!current) return;
    current.delete(handle.id);
    if (current.size === 0) activeAbortHandles.delete(turnId);
  };
}

export function clearActiveAbortEvent(turnId: string) {
  activeAbortEvents.delete(turnId);
  const timer = activeAbortEventTimers.get(turnId);
  if (timer) clearTimeout(timer);
  activeAbortEventTimers.delete(turnId);
}

export function setActiveAbortEvent(event: AgentTurnAbortEvent) {
  clearActiveAbortEvent(event.turnId);
  activeAbortEvents.set(event.turnId, event);
  activeAbortEventTimers.set(event.turnId, setTimeout(() => clearActiveAbortEvent(event.turnId), ABORT_EVENT_TTL_MS));
}

export function abortActiveTurnExecutions(event: AgentTurnAbortEvent) {
  setActiveAbortEvent(event);
  const controllers = activeAbortControllers.get(event.turnId);
  const handles = activeAbortHandles.get(event.turnId);
  let controllersAborted = 0;
  let handlesAborted = 0;

  for (const controller of controllers ?? []) {
    if (abortController(controller)) controllersAborted += 1;
  }

  for (const handle of handles?.values() ?? []) {
    abortHandle(handle);
    handlesAborted += 1;
  }

  return { controllersAborted, handlesAborted };
}

export function getActiveAbortEvent(turnId: string) {
  return activeAbortEvents.get(turnId) ?? null;
}
