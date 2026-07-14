import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url }) => {
	const spaceId = url.searchParams.get("space")?.trim() || null;
	return {
		sessionId: null as string | null,
		turnSequence: null as string | null,
		isNew: true as const,
		spaceId,
	};
};
