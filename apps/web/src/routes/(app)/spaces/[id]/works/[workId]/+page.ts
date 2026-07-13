import { readPreviewFromSearch } from "$lib/features/space/modules/workspace-preview-route";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, url }) => {
	const preview = readPreviewFromSearch(url.searchParams);
	return {
		spaceId: params.id,
		view: "work" as const,
		sessionId: null,
		filePath: null,
		checkpointId: null,
		cronjobId: null,
		taskId: null,
		workId: params.workId,
		previewKind: preview?.kind ?? null,
		previewKey: preview?.key ?? null,
	};
};
