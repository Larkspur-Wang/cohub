import type { GlobalSearchType } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";

export async function searchRemoteCommandItems(
	query: string,
	options?: {
		signal?: AbortSignal;
		limit?: number;
		types?: GlobalSearchType[];
		spaceId?: string;
	},
) {
	const q = query.trim();
	if (q.length < 2) return [];
	const fetcher: typeof fetch = (input, init) =>
		fetch(input, { ...init, signal: options?.signal });
	const result = await sdk.search.query(
		{
			q,
			limit: options?.limit ?? 30,
			types: options?.types,
			spaceId: options?.spaceId,
		},
		fetcher,
	);
	return result.items;
}
