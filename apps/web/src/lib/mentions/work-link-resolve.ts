import { sdk } from "$lib/sdk";
import { workDisplayTitle } from "$lib/work-page-meta";
import { getCohubWorkLinkKey, type ParsedCohubWorkLink } from "./work";

const LINK_RESOLVE_LIMIT = 20;

export async function resolveCohubWorkLinkMentionLabels(
	links: ParsedCohubWorkLink[],
	options?: { signal?: AbortSignal; limit?: number },
) {
	const unique = [
		...new Map(links.map((link) => [getCohubWorkLinkKey(link), link])).values(),
	].slice(0, options?.limit ?? LINK_RESOLVE_LIMIT);
	const resolved = new Map<string, string>();

	await Promise.all(
		unique.map(async (link) => {
			try {
				const { work } = await sdk.works.getBySlug(
					link.username,
					link.spaceSlug,
					link.workSlug,
					{ signal: options?.signal },
				);
				if (options?.signal?.aborted)
					throw new DOMException("Resolve aborted", "AbortError");
				resolved.set(
					getCohubWorkLinkKey(link),
					workDisplayTitle(work.meta, work.slug),
				);
			} catch (error) {
				if ((error as { name?: string })?.name === "AbortError") throw error;
				// Missing or inaccessible Works stay as ordinary pasted links.
			}
		}),
	);
	return resolved;
}
