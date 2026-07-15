/**
 * Pure rules for isolating a new-chat draft from a previously active session.
 *
 * `resolvedNewSessionId` is only meaningful while we stay on the /new route
 * after adoptPromptSession (prompt created a session, URL not yet /:id).
 * Entering /new from any other route must always start a clean draft so a
 * still-streaming previous chat cannot paint into the empty composer.
 */

export type ChatRouteKind = "none" | "new" | "session";

export function shouldClearResolvedNewSessionOnRoute(input: {
	nextKind: ChatRouteKind;
	prevKind: ChatRouteKind;
}): boolean {
	if (input.nextKind === "session") return true;
	if (input.nextKind === "none") return true;
	// Fresh draft entry from another route — drop any prior adoption handoff.
	if (input.nextKind === "new" && input.prevKind !== "new") return true;
	return false;
}

export function shouldClearActiveSessionForNewDraft(input: {
	resolvedNewSessionId: string | null;
	activeSessionId: string | null;
}): boolean {
	return !input.resolvedNewSessionId && Boolean(input.activeSessionId);
}
