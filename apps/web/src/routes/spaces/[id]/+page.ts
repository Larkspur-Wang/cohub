import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "space" as const,
		sessionId: null,
		filePath: null,
	};
};
