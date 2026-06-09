import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		spaceId: params.id,
		view: "session" as const,
		sessionId: params.sessionId,
		filePath: null,
		turnSequence: url.searchParams.get("turn"),
		layoutMode:
			url.searchParams.get("layout") === "default"
				? ("default" as const)
				: ("custom" as const),
	};
};
