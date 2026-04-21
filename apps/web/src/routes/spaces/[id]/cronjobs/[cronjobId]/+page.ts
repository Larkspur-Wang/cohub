import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "cronjob" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		cronjobId: params.cronjobId,
		taskId: null,
	};
};
