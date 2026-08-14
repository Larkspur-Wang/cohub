import type { BoardItem, WorldPoint } from "@neta-art/cohub/board";
import { TASK_CARD_FULL_DETAIL_ZOOM } from "@neta-art/cohub/board/render";
import type { BoardAssetSource } from "$lib/board/board-asset-source";

export type BoardPlayableMedia = {
	kind: "video" | "audio";
	title: string;
	resolveUrl: () => Promise<string | null>;
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
		return {
			kind: item.type,
			title: item.snapshot?.title ?? path.split("/").pop() ?? item.type,
			resolveUrl: () =>
				cachedUrl(
					`${sourceId(assetSource)}:${item.type}:file:${path}:${version}`,
					() =>
						(assetSource.resolvePlaybackUrl ?? assetSource.resolveFileUrl)(
							path,
						),
				),
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
	};
}

export function mediaPlayBadgeVisible(
	item: BoardItem,
	zoom: number,
	options: { materialized: boolean; hasVideoPreview: boolean },
): boolean {
	if (!options.materialized) return false;
	if (item.type === "video" || item.type === "audio") return true;
	if (item.type !== "task" || zoom < TASK_CARD_FULL_DETAIL_ZOOM) return false;
	const type = item.snapshot.primaryOutput?.type;
	return type === "audio" || (type === "video" && options.hasVideoPreview);
}

/** The central badge is a fixed screen-space target, independent of Board zoom. */
export function mediaPlayBadgeHit(
	item: BoardItem,
	point: WorldPoint,
	zoom: number,
): boolean {
	const radius = 28 / Math.max(zoom, 0.05);
	const centerX = item.frame.x + item.frame.width / 2;
	const centerY = item.frame.y + item.frame.height / 2;
	return Math.hypot(point.x - centerX, point.y - centerY) <= radius;
}

export function resetBoardPlaybackUrlCache() {
	resolvedUrls.clear();
}
