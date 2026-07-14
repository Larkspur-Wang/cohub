export type TurnRailMarkerAnchor = {
	sequence: number;
	absoluteTop: number;
	offsetHeight: number;
};

/**
 * Map loaded user-turn anchors onto the custom scroll rail as a content minimap.
 *
 * Marker tops are proportional to document offset (`absoluteTop / scrollHeight`),
 * so the first user message sits near the top of the rail and later turns fall
 * further down — independent of the scrollbar thumb travel range.
 */
export function measureTurnRailMarkers(input: {
	scrollHeight: number;
	clientHeight: number;
	anchors: TurnRailMarkerAnchor[];
	turnScrollAnchorOffset: number;
}): { positions: Record<number, number>; heights: Record<number, number> } {
	const scrollHeight = Math.max(1, input.scrollHeight);
	const ranges = input.anchors.map((anchor, index) => {
		const start = Math.max(
			0,
			anchor.absoluteTop - input.turnScrollAnchorOffset,
		);
		const next = input.anchors[index + 1];
		const nextStart = next
			? Math.max(0, next.absoluteTop - input.turnScrollAnchorOffset)
			: scrollHeight;
		return {
			sequence: anchor.sequence,
			offsetHeight: anchor.offsetHeight,
			start,
			end: Math.max(start, nextStart),
		};
	});

	const positions: Record<number, number> = {};
	const heights: Record<number, number> = {};
	for (const range of ranges) {
		if (!Number.isFinite(range.sequence)) continue;
		const turnHeight = Math.max(range.offsetHeight, range.end - range.start);
		// Content fraction of the full timeline, not thumb-travel coordinates.
		positions[range.sequence] = Math.min(
			100,
			Math.max(0, (range.start / scrollHeight) * 100),
		);
		const heightPercent = (turnHeight / scrollHeight) * 100;
		heights[range.sequence] = Math.min(22, Math.max(8, heightPercent));
	}
	return { positions, heights };
}
