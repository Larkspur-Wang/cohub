import { error } from "@sveltejs/kit";
import { loadPublicWorkDetail } from "$lib/server/public-api";
import {
	publicPageErrorStatus,
	setPublicPageCache,
} from "$lib/server/public-cache";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({
	params,
	fetch,
	url,
	setHeaders,
}) => {
	const result = await loadPublicWorkDetail(
		{
			username: params.username,
			spaceSlug: params.spaceSlug,
			workSlug: params.workSlug,
			pathname: url.pathname,
		},
		fetch,
	);

	if (result.ok) {
		setPublicPageCache(setHeaders, {
			private: (result.detail.work.visibility ?? "public") === "space",
		});
		return {
			mode: "ready" as const,
			work: result.detail.work,
			space: result.detail.space,
			owner: result.detail.owner,
			content: result.detail.content,
			publicUrl: result.detail.publicUrl,
			pathname: url.pathname,
			origin: url.origin,
		};
	}

	// Auth-gated space works: render a shell and finish on the client with credentials.
	if (result.needsClientAuth) {
		setPublicPageCache(setHeaders, { private: true });
		return {
			mode: "client" as const,
			pathname: url.pathname,
			origin: url.origin,
			username: params.username,
			spaceSlug: params.spaceSlug,
			workSlug: params.workSlug,
		};
	}

	// Do not setHeaders() before error() — SvelteKit may drop them on the error path.
	// Public 404 cache is applied in hooks.server.ts instead.
	const status = publicPageErrorStatus(result.status);
	error(status, status === 404 ? "Work not found" : "Failed to load work");
};
