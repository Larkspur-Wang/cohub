import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	return {
		spaceId: params.id,
		view: "task" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		cronjobId: null,
		taskId: params.taskId,
	};
};
