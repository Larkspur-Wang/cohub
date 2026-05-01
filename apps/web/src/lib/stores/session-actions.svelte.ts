import type { SessionRecord } from "@neta-art/cohub";

export type SessionActionsState = {
	session: SessionRecord | null;
};

export const sessionActions = $state.raw<SessionActionsState>({
	session: null,
});

export function openSessionActions(session: SessionRecord) {
	sessionActions.session = session;
}

export function closeSessionActions() {
	sessionActions.session = null;
}
