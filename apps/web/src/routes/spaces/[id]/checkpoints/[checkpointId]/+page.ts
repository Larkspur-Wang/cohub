import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		spaceId: params.id,
		view: "checkpoint" as const,
		sessionId: null,
		filePath: null,
		checkpointId: params.checkpointId,
		layoutMode:
			url.searchParams.get("layout") === "default"
				? ("default" as const)
				: ("custom" as const),
	};
};
