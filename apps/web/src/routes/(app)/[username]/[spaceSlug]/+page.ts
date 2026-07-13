import { readPreviewFromSearch } from "$lib/features/space/modules/workspace-preview-route";
import { sdk } from "$lib/sdk";
import { cacheSpaceRecordSoon } from "$lib/stores/space-record-cache";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	const space = await sdk.spaces.getBySlug(params.username, params.spaceSlug);
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
