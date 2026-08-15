import { sdk } from "$lib/sdk";

/** Resolve only a CDN URL suitable for streaming and byte-range requests. */
export function resolveSpaceFilePlaybackUrl(spaceId: string, path: string) {
	return sdk
		.space(spaceId)
		.files.resolveUrl(path, { purpose: "playback" })
		.catch(() => null);
}

/** Resolve a displayable URL, with an inline fallback for small files. */
export function resolveSpaceFileImageUrl(spaceId: string, path: string) {
	return sdk
		.space(spaceId)
		.files.resolveUrl(path, { purpose: "preview" })
		.catch(() => null);
}
