import { error } from "@sveltejs/kit";
import { loadPublicUserPage } from "$lib/server/public-api";
import {
	publicPageErrorStatus,
	setPublicPageCache,
} from "$lib/server/public-cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
	const result = await loadPublicUserPage(params.username, fetch);
	if (!result.ok) {
		// Avoid setHeaders() before error(); public 404 cache lives in hooks.server.ts.
		const status = publicPageErrorStatus(result.status);
		error(status, status === 404 ? "User not found" : "Failed to load profile");
	}

	setPublicPageCache(setHeaders);
	return { page: result.page };
};
