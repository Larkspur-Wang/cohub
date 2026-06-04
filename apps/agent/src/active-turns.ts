import type { AgentTurnAbortEvent } from "./abort.js";

const activeAbortControllers = new Map<string, AbortController>();
const activeAbortEvents = new Map<string, AgentTurnAbortEvent>();

export function getActiveAbortController(turnId: string) {
  return activeAbortControllers.get(turnId) ?? null;
}

export function setActiveAbortController(turnId: string, controller: AbortController) {
  activeAbortControllers.set(turnId, controller);
  activeAbortEvents.delete(turnId);
}

export function clearActiveAbortController(turnId: string, controller: AbortController) {
  if (activeAbortControllers.get(turnId) === controller) {
    activeAbortControllers.delete(turnId);
    activeAbortEvents.delete(turnId);
  }
}

export function setActiveAbortEvent(event: AgentTurnAbortEvent) {
  activeAbortEvents.set(event.turnId, event);
}

export function getActiveAbortEvent(turnId: string) {
  return activeAbortEvents.get(turnId) ?? null;
}
