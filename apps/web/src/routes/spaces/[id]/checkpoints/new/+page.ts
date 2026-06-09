import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "checkpoint-new" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
	};
};
