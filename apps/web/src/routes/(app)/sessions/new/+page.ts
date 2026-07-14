import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url }) => {
	// Use newChatSpaceId — never `spaceId`. App layout treats page.data.spaceId as
	// the active workspace for per-space sidebar layout prefs; a draft target
	// space must not collapse/expand the global left rail when switching spaces.
	const newChatSpaceId = url.searchParams.get("space")?.trim() || null;
	return {
		sessionId: null as string | null,
		turnSequence: null as string | null,
		isNew: true as const,
		newChatSpaceId,
		spaceId: null as string | null,
	};
};
