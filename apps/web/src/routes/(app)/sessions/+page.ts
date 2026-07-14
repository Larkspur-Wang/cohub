import type { PageLoad } from "./$types";

export const load: PageLoad = async () => {
	return {
		sessionId: null as string | null,
		turnSequence: null as string | null,
	};
};
