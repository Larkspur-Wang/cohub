import { error } from "@sveltejs/kit";
import { loadPublicUserPage } from "$lib/server/public-api";
import { setPublicPageCache } from "$lib/server/public-cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
	const result = await loadPublicUserPage(params.username, fetch);
	if (result.ok) {
		setPublicPageCache(setHeaders);
		return {
			mode: "ready" as const,
			page: result.page,
		};
	}

	if (result.status === 404) {
		error(404, "User not found");
	}

	// Soft-fail: keep the route alive and let the client revalidate with SDK.
	setPublicPageCache(setHeaders, { private: true });
	return {
		mode: "client" as const,
		username: params.username,
	};
};
