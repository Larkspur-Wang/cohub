/**
 * Canvas color palette — a small, named set of shape colors shared by note,
 * geo, draw and arrow shapes. Colors are stored by id in shape props (never
 * raw hex), so themes and space `.cohub/theme.css` can remap them via CSS
 * tokens while persisted data stays compact and forward-compatible.
 *
 * Concrete values are resolved from CSS variables at render time:
 *   --canvas-color-{id}-stroke | -fill | -label
 * with hard-coded light/dark tables as offline / export fallbacks.
 */

export type CanvasColorId =
	| "brand"
	| "neutral"
	| "blue"
	| "green"
	| "amber"
	| "violet"
	| "rose";

export type CanvasColorValue = {
	/** Stroke / accent color (sRGB hex). */
	stroke: number;
	/** Translucent fill used behind shapes (sRGB hex). */
	fill: number;
	/** Readable label color on top of the fill. */
	label: number;
};

export type CanvasColorEntry = {
	id: CanvasColorId;
	label: string;
	dark: CanvasColorValue;
	light: CanvasColorValue;
};

export const CANVAS_COLORS: readonly CanvasColorEntry[] = [
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

export const DEFAULT_CANVAS_COLOR: CanvasColorId = "brand";

const COLOR_INDEX: ReadonlyMap<CanvasColorId, CanvasColorEntry> = new Map(
	CANVAS_COLORS.map((entry) => [entry.id, entry]),
);

export function isCanvasColorId(value: unknown): value is CanvasColorId {
	return typeof value === "string" && COLOR_INDEX.has(value as CanvasColorId);
}

export function canvasColorCssVar(
	id: CanvasColorId,
	part: keyof CanvasColorValue,
): string {
	return `--canvas-color-${id}-${part}`;
}

/** Resolve a color id to concrete values for a color mode. Unknown → brand. */
export function resolveCanvasColor(
	id: unknown,
	mode: "dark" | "light",
): CanvasColorValue {
	const entry =
		(isCanvasColorId(id) ? COLOR_INDEX.get(id) : undefined) ??
		COLOR_INDEX.get(DEFAULT_CANVAS_COLOR);
	// COLOR_INDEX always has the default, so this is non-null.
	return (entry as CanvasColorEntry)[mode];
}

export type CanvasShapeColors = Record<CanvasColorId, CanvasColorValue>;

/** Build a full shape-color table from hard-coded fallbacks (export / SSR). */
export function buildFallbackShapeColors(
	mode: "dark" | "light",
): CanvasShapeColors {
	const out = {} as CanvasShapeColors;
	for (const entry of CANVAS_COLORS) {
		out[entry.id] = entry[mode];
	}
	return out;
}

/**
 * Pick a concrete color from a live shape-color table, falling back to the
 * default brand entry when the id is unknown.
 */
export function pickCanvasColor(
	colors: CanvasShapeColors | null | undefined,
	id: unknown,
	mode: "dark" | "light" = "dark",
): CanvasColorValue {
	if (colors && isCanvasColorId(id) && colors[id]) return colors[id];
	if (colors) return colors[DEFAULT_CANVAS_COLOR];
	return resolveCanvasColor(id, mode);
}
