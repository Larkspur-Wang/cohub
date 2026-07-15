export type PixelRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Map a CSS-pixel DOM rect into bitmap/video pixel space. */
export function cssRectToPixelRect(
	rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
	options: {
		dpr: number;
		frameWidth: number;
		frameHeight: number;
		/** Origin of the captured surface in CSS pixels (usually 0,0 for tab). */
		originLeft?: number;
		originTop?: number;
	},
): PixelRect {
	const dpr = options.dpr > 0 ? options.dpr : 1;
	const originLeft = options.originLeft ?? 0;
	const originTop = options.originTop ?? 0;
	const x = Math.round((rect.left - originLeft) * dpr);
	const y = Math.round((rect.top - originTop) * dpr);
	const width = Math.round(rect.width * dpr);
	const height = Math.round(rect.height * dpr);
	return clampPixelRect(
		{ x, y, width, height },
		options.frameWidth,
		options.frameHeight,
	);
}

export function clampPixelRect(
	rect: PixelRect,
	frameWidth: number,
	frameHeight: number,
): PixelRect {
	const x = Math.max(0, Math.min(frameWidth, rect.x));
	const y = Math.max(0, Math.min(frameHeight, rect.y));
	const right = Math.max(x, Math.min(frameWidth, rect.x + rect.width));
	const bottom = Math.max(y, Math.min(frameHeight, rect.y + rect.height));
	return {
		x,
		y,
		width: Math.max(1, right - x),
		height: Math.max(1, bottom - y),
	};
}

export function normalizeCropRect(
	a: { x: number; y: number },
	b: { x: number; y: number },
	frameWidth: number,
	frameHeight: number,
): PixelRect {
	const x1 = Math.min(a.x, b.x);
	const y1 = Math.min(a.y, b.y);
	const x2 = Math.max(a.x, b.x);
	const y2 = Math.max(a.y, b.y);
	return clampPixelRect(
		{ x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
		frameWidth,
		frameHeight,
	);
}
