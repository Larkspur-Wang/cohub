import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "cronjob-new" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		cronjobId: null,
		taskId: null,
	};
};
