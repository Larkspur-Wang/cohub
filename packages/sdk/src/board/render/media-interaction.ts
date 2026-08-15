import type { BoardItem } from "@cohub/protocol/board-document";
import type { WorldPoint } from "../geometry.js";
import { TASK_CARD_FULL_DETAIL_ZOOM } from "./renderers/task-card-renderer.js";

export type BoardMediaAction = {
	action: "play-media";
	itemId: string;
};

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

export function boardMediaActionAt(
	item: BoardItem,
	point: WorldPoint,
	zoom: number,
	options: { materialized: boolean; hasVideoPreview: boolean },
): BoardMediaAction | null {
	return mediaPlayBadgeVisible(item, zoom, options) &&
		mediaPlayBadgeHit(item, point, zoom)
		? { action: "play-media", itemId: item.id }
		: null;
}
