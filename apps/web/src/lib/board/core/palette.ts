/**
 * Board color palette — a small, named set of shape colors shared by note,
 * geo, draw and arrow shapes. Colors are stored by id in shape props (never
 * raw hex), so themes and space `.cohub/theme.css` can remap them via CSS
 * tokens while persisted data stays compact and forward-compatible.
 *
 * Concrete values are resolved from CSS variables at render time:
 *   --board-color-{id}-stroke | -fill | -label
 * with hard-coded light/dark tables as offline / export fallbacks.
 */

export type BoardColorId =
	| "brand"
	| "neutral"
	| "blue"
	| "green"
	| "amber"
	| "violet"
	| "rose";

export type BoardColorValue = {
	/** Stroke / accent color (sRGB hex). */
	stroke: number;
	/** Translucent fill used behind shapes (sRGB hex). */
	fill: number;
	/** Readable label color on top of the fill. */
	label: number;
};

export type BoardColorEntry = {
	id: BoardColorId;
	label: string;
	dark: BoardColorValue;
	light: BoardColorValue;
};

export const BOARD_COLORS: readonly BoardColorEntry[] = [
	{
		id: "brand",
		label: "Brand",
		dark: { stroke: 0xff5a1f, fill: 0xff5a1f, label: 0xfff1ea },
		light: { stroke: 0xe8450e, fill: 0xe8450e, label: 0x3a1204 },
	},
	{
		id: "neutral",
		label: "Neutral",
		dark: { stroke: 0x9aa0a6, fill: 0x9aa0a6, label: 0xf4f4f4 },
		light: { stroke: 0x5f6368, fill: 0x5f6368, label: 0xffffff },
	},
	{
		id: "blue",
		label: "Blue",
		dark: { stroke: 0x38bdf8, fill: 0x38bdf8, label: 0xeaf6ff },
		light: { stroke: 0x2563eb, fill: 0x2563eb, label: 0xffffff },
	},
	{
		id: "green",
		label: "Green",
		dark: { stroke: 0x34d399, fill: 0x34d399, label: 0xe9fbf3 },
		light: { stroke: 0x16a34a, fill: 0x16a34a, label: 0xffffff },
	},
	{
		id: "amber",
		label: "Amber",
		dark: { stroke: 0xf59e0b, fill: 0xf59e0b, label: 0x2a1c02 },
		light: { stroke: 0xd97706, fill: 0xd97706, label: 0x2a1c02 },
	},
	{
		id: "violet",
		label: "Violet",
		dark: { stroke: 0xa78bfa, fill: 0xa78bfa, label: 0xf3eeff },
		light: { stroke: 0x7c3aed, fill: 0x7c3aed, label: 0xffffff },
	},
	{
		id: "rose",
		label: "Rose",
		dark: { stroke: 0xfb7185, fill: 0xfb7185, label: 0xffeef1 },
		light: { stroke: 0xe11d48, fill: 0xe11d48, label: 0xffffff },
	},
] as const;

export const DEFAULT_BOARD_COLOR: BoardColorId = "brand";

const COLOR_INDEX: ReadonlyMap<BoardColorId, BoardColorEntry> = new Map(
	BOARD_COLORS.map((entry) => [entry.id, entry]),
);

export function isBoardColorId(value: unknown): value is BoardColorId {
	return typeof value === "string" && COLOR_INDEX.has(value as BoardColorId);
}

export function boardColorCssVar(
	id: BoardColorId,
	part: keyof BoardColorValue,
): string {
	return `--board-color-${id}-${part}`;
}

/** Resolve a color id to concrete values for a color mode. Unknown → brand. */
export function resolveBoardColor(
	id: unknown,
	mode: "dark" | "light",
): BoardColorValue {
	const entry =
		(isBoardColorId(id) ? COLOR_INDEX.get(id) : undefined) ??
		COLOR_INDEX.get(DEFAULT_BOARD_COLOR);
	// COLOR_INDEX always has the default, so this is non-null.
	return (entry as BoardColorEntry)[mode];
}

export type BoardShapeColors = Record<BoardColorId, BoardColorValue>;

/** Build a full shape-color table from hard-coded fallbacks (export / SSR). */
export function buildFallbackShapeColors(
	mode: "dark" | "light",
): BoardShapeColors {
	const out = {} as BoardShapeColors;
	for (const entry of BOARD_COLORS) {
		out[entry.id] = entry[mode];
	}
	return out;
}

/**
 * Pick a concrete color from a live shape-color table, falling back to the
 * default brand entry when the id is unknown.
 */
export function pickBoardColor(
	colors: BoardShapeColors | null | undefined,
	id: unknown,
	mode: "dark" | "light" = "dark",
): BoardColorValue {
	if (colors && isBoardColorId(id) && colors[id]) return colors[id];
	if (colors) return colors[DEFAULT_BOARD_COLOR];
	return resolveBoardColor(id, mode);
}
