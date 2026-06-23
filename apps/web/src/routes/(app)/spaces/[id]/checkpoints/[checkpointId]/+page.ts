import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "checkpoint" as const,
		sessionId: null,
		filePath: null,
		checkpointId: params.checkpointId,
	};
};
