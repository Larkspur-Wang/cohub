import { readPreviewFromSearch } from "$lib/features/space/modules/workspace-preview-route";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	const preview = readPreviewFromSearch(url.searchParams);
	return {
		spaceId: params.id,
		view: "session" as const,
		sessionId: params.sessionId,
		filePath: null,
		previewKind: preview?.kind ?? null,
		previewKey: preview?.key ?? null,
		turnSequence: url.searchParams.get("turn"),
	};
};
