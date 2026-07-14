export type TurnRailMarkerAnchor = {
	sequence: number;
	absoluteTop: number;
	offsetHeight: number;
};

/**
 * Map loaded user-turn anchors onto the custom scroll rail.
 * Positions use the same thumb travel range as TurnRail (`100 - thumbHeight%`),
 * so markers line up with the scrollbar thumb track — not the full panel chrome.
 */
export function measureTurnRailMarkers(input: {
	scrollHeight: number;
	clientHeight: number;
	anchors: TurnRailMarkerAnchor[];
	turnScrollAnchorOffset: number;
}): { positions: Record<number, number>; heights: Record<number, number> } {
	const scrollHeight = Math.max(0, input.scrollHeight);
	const clientHeight = Math.max(0, input.clientHeight);
	const maxScroll = Math.max(1, scrollHeight - clientHeight);
	const railThumbHeightPercent = Math.min(
		64,
		Math.max(6, scrollHeight > 0 ? (clientHeight / scrollHeight) * 100 : 100),
	);
	const railUsablePercent = 100 - railThumbHeightPercent;
	const toRailTopPercent = (scrollTop: number) =>
		Math.min(
			railUsablePercent,
			Math.max(0, (scrollTop / maxScroll) * railUsablePercent),
		);

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
		positions[range.sequence] = toRailTopPercent(range.start);
		const scrollRatio = Math.max(0.015, turnHeight / maxScroll);
		heights[range.sequence] = Math.min(22, Math.max(8, scrollRatio * 100));
	}
	return { positions, heights };
}
