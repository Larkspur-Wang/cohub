import type { AgentTurnAbortEvent } from "./abort.js";

const activeAbortControllers = new Map<string, Set<AbortController>>();
const activeAbortEvents = new Map<string, AgentTurnAbortEvent>();

export function getActiveAbortControllers(turnId: string) {
  return activeAbortControllers.get(turnId) ?? null;
}

export function setActiveAbortController(turnId: string, controller: AbortController) {
  const controllers = activeAbortControllers.get(turnId) ?? new Set<AbortController>();
  controllers.add(controller);
  activeAbortControllers.set(turnId, controllers);
  activeAbortEvents.delete(turnId);
}

export function clearActiveAbortController(turnId: string, controller: AbortController) {
  const controllers = activeAbortControllers.get(turnId);
  if (!controllers) return;
  controllers.delete(controller);
  if (controllers.size === 0) {
    activeAbortControllers.delete(turnId);
    activeAbortEvents.delete(turnId);
  }
}

export function setActiveAbortEvent(event: AgentTurnAbortEvent) {
  activeAbortEvents.set(event.turnId, event);
}

export function abortActiveTurnControllers(event: AgentTurnAbortEvent) {
  setActiveAbortEvent(event);
  const controllers = activeAbortControllers.get(event.turnId);
  if (!controllers) return 0;
  let aborted = 0;
  for (const controller of controllers) {
    if (!controller.signal.aborted) {
      controller.abort();
      aborted += 1;
    }
  }
  return aborted;
}

export function getActiveAbortEvent(turnId: string) {
  return activeAbortEvents.get(turnId) ?? null;
}
