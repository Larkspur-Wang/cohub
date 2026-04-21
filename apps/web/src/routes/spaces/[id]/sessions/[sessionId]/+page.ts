import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "session" as const,
		sessionId: params.sessionId,
		filePath: null,
	};
};
