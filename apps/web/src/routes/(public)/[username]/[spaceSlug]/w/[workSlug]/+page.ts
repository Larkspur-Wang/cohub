import { sdk } from "$lib/sdk";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params }) => {
	const result = await sdk.works.getBySlug(
		params.username,
		params.spaceSlug,
		params.workSlug,
	);
	return {
		work: result.work,
		space: result.space,
		owner: result.owner,
		content: result.content,
	};
};
