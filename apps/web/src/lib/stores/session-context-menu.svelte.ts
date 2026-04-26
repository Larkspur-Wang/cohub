import type { SessionRecord } from "@neta-art/cohub";

export type SessionContextMenuState = {
	session: SessionRecord | null;
};

export const sessionContextMenu = $state.raw<SessionContextMenuState>({
	session: null,
});

export function openSessionContextMenu(session: SessionRecord) {
	sessionContextMenu.session = session;
}

export function closeSessionContextMenu() {
	sessionContextMenu.session = null;
}
