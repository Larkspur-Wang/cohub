import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	return {
		spaceId: params.id,
		view: "space" as const,
		sessionId: null,
		filePath: null,
		homeTab: url.searchParams.get("tab"),
	};
};
