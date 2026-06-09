import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		spaceId: params.id,
		view: "checkpoint-new" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		layoutMode:
			url.searchParams.get("layout") === "default"
				? ("default" as const)
				: ("custom" as const),
	};
};
