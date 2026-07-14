export type TurnRailMarkerAnchor = {
	sequence: number;
	absoluteTop: number;
	offsetHeight: number;
};

/**
 * Map loaded user-turn anchors onto the custom scroll rail as a content minimap.
 *
 * Tops are document fractions of the timeline content range that starts at the
 * first measured user turn, so the first user message sits flush at the rail
 * top. Jump/scroll comfort offsets are intentionally excluded — those belong
 * only to scroll-into-view behavior, not marker placement.
 */
export function measureTurnRailMarkers(input: {
	scrollHeight: number;
	clientHeight: number;
	anchors: TurnRailMarkerAnchor[];
}): { positions: Record<number, number>; heights: Record<number, number> } {
	const scrollHeight = Math.max(1, input.scrollHeight);
	const anchors = input.anchors.filter((anchor) =>
		Number.isFinite(anchor.sequence),
	);
	if (anchors.length === 0) {
		return { positions: {}, heights: {} };
	}

	// Content origin = first user bubble top (includes timeline padding). Zeroing
	// here keeps the first turn marker flush with the rail top.
	const origin = Math.min(
		...anchors.map((anchor) => Math.max(0, anchor.absoluteTop)),
	);
	const contentSpan = Math.max(1, scrollHeight - origin);

	const ranges = anchors.map((anchor, index) => {
		const start = Math.max(0, anchor.absoluteTop - origin);
		const next = anchors[index + 1];
		const nextStart = next
			? Math.max(0, next.absoluteTop - origin)
			: contentSpan;
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
		const turnHeight = Math.max(range.offsetHeight, range.end - range.start);
		positions[range.sequence] = Math.min(
			100,
			Math.max(0, (range.start / contentSpan) * 100),
		);
		const heightPercent = (turnHeight / contentSpan) * 100;
		heights[range.sequence] = Math.min(22, Math.max(8, heightPercent));
	}
	return { positions, heights };
}
