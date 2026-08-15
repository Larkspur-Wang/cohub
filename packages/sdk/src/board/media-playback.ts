import type { BoardItem } from "@cohub/protocol/board-document";

export type BoardAssetSource = {
	/** Displayable preview URL for a workspace-file reference. */
	resolveFileUrl: (path: string) => Promise<string | null>;
	/** Streamable URL for audio/video. Never return an inline data URL. */
	resolvePlaybackUrl?: (path: string) => Promise<string | null>;
};

export type BoardPlayableMedia = {
	kind: "video" | "audio";
	title: string;
	resolveUrl: () => Promise<string | null>;
	/** Drop a failed or expired resolved URL without affecting other media. */
	invalidateUrl: () => void;
};

const resolvedUrls = new Map<string, Promise<string | null>>();
const sourceIds = new WeakMap<BoardAssetSource, number>();
const URL_CACHE_LIMIT = 64;
let nextSourceId = 1;

function sourceId(source: BoardAssetSource) {
	let id = sourceIds.get(source);
	if (id === undefined) {
		id = nextSourceId;
		nextSourceId += 1;
		sourceIds.set(source, id);
	}
	return id;
}

function invalidateCachedUrl(key: string) {
	resolvedUrls.delete(key);
}

function cachedUrl(key: string, resolve: () => Promise<string | null>) {
	let pending = resolvedUrls.get(key);
	if (!pending) {
		if (resolvedUrls.size >= URL_CACHE_LIMIT) {
			const oldest = resolvedUrls.keys().next().value;
			if (oldest !== undefined) resolvedUrls.delete(oldest);
		}
		pending = resolve()
			.catch(() => null)
			.then((url) => {
				if (!url) resolvedUrls.delete(key);
				return url;
			});
		resolvedUrls.set(key, pending);
	}
	return pending;
}

export function playableBoardMedia(
	item: BoardItem | null,
	assetSource: BoardAssetSource,
): BoardPlayableMedia | null {
	if (item?.type === "video" || item?.type === "audio") {
		const path = item.ref.path;
		const version = item.snapshot?.mtimeMs ?? "unknown";
		const cacheKey = `${sourceId(assetSource)}:${item.type}:file:${path}:${version}`;
		return {
			kind: item.type,
			title: item.snapshot?.title ?? path.split("/").pop() ?? item.type,
			resolveUrl: () =>
				cachedUrl(cacheKey, () =>
					(assetSource.resolvePlaybackUrl ?? assetSource.resolveFileUrl)(path),
				),
			invalidateUrl: () => invalidateCachedUrl(cacheKey),
		};
	}
	if (item?.type !== "task") return null;
	const output = item.snapshot.primaryOutput;
	if (!output?.url || (output.type !== "video" && output.type !== "audio"))
		return null;
	return {
		kind: output.type,
		title: item.snapshot.title,
		resolveUrl: () => Promise.resolve(output.url ?? null),
		invalidateUrl: () => {},
	};
}

export function resetBoardPlaybackUrlCache() {
	resolvedUrls.clear();
}
