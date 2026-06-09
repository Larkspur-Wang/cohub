import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => ({
	spaceId: params.id,
	layoutMode:
		url.searchParams.get("layout") === "default"
			? ("default" as const)
			: ("custom" as const),
});
