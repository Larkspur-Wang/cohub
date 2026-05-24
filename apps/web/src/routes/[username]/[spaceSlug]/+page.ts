import { sdk } from "$lib/sdk";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	const space = await sdk.spaces.getBySlug(params.username, params.spaceSlug);
	const sessionId = url.searchParams.get("session");
	const filePath = url.searchParams.get("file");

	return {
		spaceId: space.id,
		view: sessionId
			? ("session" as const)
			: filePath
				? ("file" as const)
				: ("space" as const),
		sessionId,
		filePath,
	};
};
