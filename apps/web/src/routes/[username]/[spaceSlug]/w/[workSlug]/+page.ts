import { PUBLIC_API_ORIGIN } from "$env/static/public";
import { sdk } from "$lib/sdk";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
	const result = await sdk.works.getBySlug(
		params.username,
		params.spaceSlug,
		params.workSlug,
	);
	const response = await fetch(
		`${PUBLIC_API_ORIGIN ?? ""}/api/works/${result.work.id}/content`,
	);
	const content = response.ok ? await response.json() : null;
	return {
		work: result.work,
		owner: result.owner,
		content,
	};
};
