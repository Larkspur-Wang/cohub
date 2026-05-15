const activeAbortControllers = new Map<string, AbortController>();

export function getActiveAbortController(turnId: string) {
  return activeAbortControllers.get(turnId) ?? null;
}

export function setActiveAbortController(turnId: string, controller: AbortController) {
  activeAbortControllers.set(turnId, controller);
}

export function clearActiveAbortController(turnId: string, controller: AbortController) {
  if (activeAbortControllers.get(turnId) === controller) activeAbortControllers.delete(turnId);
}
