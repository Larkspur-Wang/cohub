import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
	return {
		sessionId: null as string | null,
		turnSequence: null as string | null,
		isNew: false as const,
		newChatSpaceId: null as string | null,
		spaceId: null as string | null,
	};
};
