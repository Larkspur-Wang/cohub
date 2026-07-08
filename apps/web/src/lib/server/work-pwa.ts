import type { WorkDetailResponse } from "@neta-art/cohub";
import { PUBLIC_API_ORIGIN } from "$env/static/public";
import type { PublicWorkPath } from "$lib/work-pwa";

export async function loadPublicWorkDetail(
	path: PublicWorkPath | null,
	fetcher: typeof fetch,
): Promise<WorkDetailResponse | null> {
	if (!path) return null;
	const baseUrl = PUBLIC_API_ORIGIN ?? "";
	const apiPath = `/api/works/by-slug/${encodeURIComponent(path.username)}/${encodeURIComponent(path.spaceSlug)}/${encodeURIComponent(path.workSlug)}`;
	const response = await fetcher(`${baseUrl}${apiPath}`).catch(() => null);
	if (!response?.ok) return null;
	return response.json().catch(() => null);
}
