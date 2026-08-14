import { sdk } from "$lib/sdk";

/**
 * Resolve a displayable URL for a space-file image. Prefers the CDN `url`
 * delivery; falls back to an inline base64 data URL.
 */
const PLAYBACK_RESOLVE_ATTEMPTS = 6;

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Resolve only a CDN URL suitable for streaming and byte-range requests. */
export async function resolveSpaceFilePlaybackUrl(
	spaceId: string,
	path: string,
): Promise<string | null> {
	for (let attempt = 0; attempt < PLAYBACK_RESOLVE_ATTEMPTS; attempt += 1) {
		try {
			const file = await sdk.space(spaceId).files.read(path);
			if ("content" in file) {
				return file.delivery === "url" && file.url ? file.url : null;
			}
			if (attempt < PLAYBACK_RESOLVE_ATTEMPTS - 1)
				await sleep(Math.max(250, Math.min(file.retryAfterMs, 2_000)));
		} catch {
			return null;
		}
	}
	return null;
}

export async function resolveSpaceFileImageUrl(
	spaceId: string,
	path: string,
): Promise<string | null> {
	try {
		const file = await sdk.space(spaceId).files.read(path);
		if (!("content" in file)) return null;
		if (file.delivery === "url" && file.url) return file.url;
		if (file.content) {
			const mime = file.mimeType ?? "image/png";
			return `data:${mime};base64,${file.content}`;
		}
		return null;
	} catch {
		return null;
	}
}
