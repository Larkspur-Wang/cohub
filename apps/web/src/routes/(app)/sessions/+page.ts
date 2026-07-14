import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
	return {
		sessionId: null as string | null,
		turnSequence: null as string | null,
		isNew: false as const,
		spaceId: null as string | null,
	};
};
