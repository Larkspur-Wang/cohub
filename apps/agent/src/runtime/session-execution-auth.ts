const currentBySessionId = new Map<string, { actorUserId: string | null; executionToken: string | null }>();

export function setCurrentSessionExecutionAuth(input: {
  sessionId: string;
  actorUserId?: string | null;
  executionToken?: string | null;
}) {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;
  currentBySessionId.set(sessionId, {
    actorUserId: input.actorUserId?.trim() || null,
    executionToken: input.executionToken?.trim() || null,
  });
}

export function getCurrentSessionExecutionAuth(sessionId: string) {
  return currentBySessionId.get(sessionId.trim()) ?? null;
}

export function clearCurrentSessionExecutionAuth(sessionId: string) {
  currentBySessionId.delete(sessionId.trim());
}
