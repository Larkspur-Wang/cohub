import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		spaceId: params.id,
		view: "task" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		cronjobId: null,
		taskId: params.taskId,
		layoutMode:
			url.searchParams.get("layout") === "default"
				? ("default" as const)
				: ("custom" as const),
	};
};
