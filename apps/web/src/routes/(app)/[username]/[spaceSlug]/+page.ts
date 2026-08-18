import { HttpError } from "@neta-art/cohub";
import { error } from "@sveltejs/kit";
import { readPreviewFromSearch } from "$lib/features/space/modules/workspace-preview-route";
import { sdk } from "$lib/sdk";
import { cacheSpaceRecordSoon } from "$lib/stores/space-record-cache";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	const space = await sdk.spaces
		.getBySlug(params.username, params.spaceSlug)
		.catch((err) => {
			// SvelteKit only honors status codes on its own errors; rethrow SDK
			// HttpErrors so a missing space lands on the 404 boundary, not a 500.
			if (err instanceof HttpError) throw error(err.status, err.message);
			throw err;
		});
	cacheSpaceRecordSoon(space);
	const sessionId = url.searchParams.get("session");
	// Prefer ?preview=; legacy ?file= maps to file preview.
	const preview =
		readPreviewFromSearch(url.searchParams) ??
		(url.searchParams.get("file")
			? {
					kind: "file" as const,
					key: url.searchParams.get("file") as string,
				}
			: null);

	return {
		spaceId: space.id,
		view: "session" as const,
		sessionId: sessionId ?? "new",
		filePath: null,
		previewKind: preview?.kind ?? null,
		previewKey: preview?.key ?? null,
	};
};
