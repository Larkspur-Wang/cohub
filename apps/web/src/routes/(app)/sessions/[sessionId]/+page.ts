import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		sessionId: params.sessionId,
		turnSequence: url.searchParams.get("turn"),
		isNew: false as const,
		newChatSpaceId: null as string | null,
		spaceId: null as string | null,
	};
};
