import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		spaceId: params.id,
		view: "cronjob" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		cronjobId: params.cronjobId,
		taskId: null,
		layoutMode:
			url.searchParams.get("layout") === "default"
				? ("default" as const)
				: ("custom" as const),
	};
};
