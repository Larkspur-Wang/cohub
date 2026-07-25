/** World-space typography shared by the editor, DOM overlay and renderer. */
export const TEXT_FONT_FAMILY = "Geist";
export const TEXT_FONT_SIZE = 18;
export const TEXT_LINE_HEIGHT = 24;
export const TEXT_MIN_FONT_SIZE = 2;
export const TEXT_MAX_FONT_SIZE = 512;

const TEXT_LINE_HEIGHT_RATIO = TEXT_LINE_HEIGHT / TEXT_FONT_SIZE;
const TEXT_MIN_WIDTH_RATIO = 16 / TEXT_FONT_SIZE;
const TEXT_HORIZONTAL_PADDING_RATIO = 2 / TEXT_FONT_SIZE;

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

export function clampBoardTextFontSize(fontSize: number): number {
	return Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, fontSize));
}

export function boardTextLineHeight(fontSize: number): number {
	return clampBoardTextFontSize(fontSize) * TEXT_LINE_HEIGHT_RATIO;
}

/** Measure unwrapped plain text into scalable world-space bounds. */
export function measureBoardText(
	text: string,
	fontSize = TEXT_FONT_SIZE,
): { width: number; height: number } {
	const size = clampBoardTextFontSize(fontSize);
	const lines = (text || " ").split("\n");
	const minWidth = size * TEXT_MIN_WIDTH_RATIO;
	const horizontalPadding = size * TEXT_HORIZONTAL_PADDING_RATIO;
	const lineHeight = boardTextLineHeight(size);
	const context = getMeasureContext();
	let width = minWidth;

	if (context) {
		context.font = `500 ${size}px ${TEXT_FONT_FAMILY}, system-ui, sans-serif`;
		for (const line of lines) {
			width = Math.max(
				width,
				context.measureText(line || " ").width + horizontalPadding,
			);
		}
	} else {
		const characterWidth = size * 0.52;
		for (const line of lines) {
			width = Math.max(
				width,
				Math.max(1, line.length) * characterWidth + horizontalPadding,
			);
		}
	}

	return {
		width,
		height: Math.max(lineHeight, lines.length * lineHeight),
	};
}
