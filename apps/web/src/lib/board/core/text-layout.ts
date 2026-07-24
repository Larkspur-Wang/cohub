/** World-space typography shared by the editor, DOM overlay and renderers. */
export const TEXT_FONT_SIZE = 18;
export const TEXT_LINE_HEIGHT = 24;
export const TEXT_FONT_FAMILY = "Geist";
export const TEXT_MIN_WIDTH = 16;
export const TEXT_MIN_HEIGHT = TEXT_LINE_HEIGHT;

let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
	if (measureContext !== undefined) return measureContext;
	if (typeof document === "undefined") {
		measureContext = null;
		return null;
	}
	const canvas = document.createElement("canvas");
	measureContext = canvas.getContext("2d");
	return measureContext;
}

/** Measure plain text into deterministic world-space bounds. */
export function measureBoardText(
	text: string,
	maxWidth?: number | null,
): { width: number; height: number } {
	const lines = (text || " ").split("\n");
	const context = getMeasureContext();
	if (context) {
		context.font = `500 ${TEXT_FONT_SIZE}px ${TEXT_FONT_FAMILY}, system-ui, sans-serif`;
		if (maxWidth && maxWidth > 0) {
			const width = Math.max(TEXT_MIN_WIDTH, maxWidth);
			let rows = 0;
			for (const line of lines) {
				if (!line) {
					rows += 1;
					continue;
				}
				let remaining = line;
				while (remaining.length > 0) {
					if (context.measureText(remaining).width <= width) {
						rows += 1;
						break;
					}
					let low = 1;
					let high = remaining.length;
					while (low < high) {
						const middle = Math.ceil((low + high) / 2);
						if (context.measureText(remaining.slice(0, middle)).width <= width)
							low = middle;
						else high = middle - 1;
					}
					rows += 1;
					remaining = remaining.slice(Math.max(1, low));
				}
			}
			return {
				width,
				height: Math.max(TEXT_MIN_HEIGHT, rows * TEXT_LINE_HEIGHT),
			};
		}
		let width = TEXT_MIN_WIDTH;
		for (const line of lines) {
			width = Math.max(
				width,
				Math.ceil(context.measureText(line || " ").width) + 2,
			);
		}
		return {
			width,
			height: Math.max(TEXT_MIN_HEIGHT, lines.length * TEXT_LINE_HEIGHT),
		};
	}

	const characterWidth = TEXT_FONT_SIZE * 0.52;
	let width = TEXT_MIN_WIDTH;
	if (maxWidth && maxWidth > 0) {
		width = Math.max(TEXT_MIN_WIDTH, maxWidth);
		let rows = 0;
		for (const line of lines) {
			const characters = Math.max(1, line.length);
			rows += Math.max(1, Math.ceil((characters * characterWidth) / width));
		}
		return {
			width,
			height: Math.max(TEXT_MIN_HEIGHT, rows * TEXT_LINE_HEIGHT),
		};
	}
	for (const line of lines) {
		width = Math.max(width, Math.ceil(line.length * characterWidth) + 2);
	}
	return {
		width,
		height: Math.max(TEXT_MIN_HEIGHT, lines.length * TEXT_LINE_HEIGHT),
	};
}
