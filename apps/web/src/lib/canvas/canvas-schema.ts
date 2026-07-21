import { z } from "zod";

export const COVAS_EXTENSION = ".covas";
export const CANVAS_DOCUMENT_KIND = "cohub.canvas" as const;

export const CanvasFrameSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().finite().positive(),
	height: z.number().finite().positive(),
	rotation: z.number().finite().default(0),
});

/**
 * The canvas camera. This is local UI state, not synced content: semantic ops
 * (see diffCanvasDocuments) never describe the viewport, and the editor holds
 * the live camera separately from the persisted document. Here it only serves
 * as an initial camera hint when a document is first loaded.
 */
export const CanvasViewportSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	zoom: z.number().finite().min(0.1).max(4),
});

export const CanvasAppearanceSchema = z.object({
	theme: z.string().min(1).default("clean"),
	background: z
		.object({
			kind: z
				.enum(["solid", "grid", "image", "shader", "custom"])
				.default("grid"),
			color: z.string().optional(),
			imageUrl: z.string().url().optional(),
		})
		.default({ kind: "grid" }),
	grid: z
		.object({
			visible: z.boolean().default(true),
			size: z.number().finite().min(4).default(32),
			opacity: z.number().finite().min(0).max(1).default(0.22),
		})
		.default({ visible: true, size: 32, opacity: 0.22 }),
	mood: z
		.enum(["clean", "playful", "arcane", "cyber", "natural"])
		.default("clean"),
});

/**
 * Legacy visual style carried by resource/text items. Newer shapes (note, geo,
 * draw, arrow) carry a palette `color` id in their own props instead; this stays
 * for backward compatibility with existing documents and is never required.
 */
export const CanvasItemStyleSchema = z.object({
	variant: z.string().min(1).default("default"),
	theme: z.string().min(1).optional(),
	accentColor: z.string().optional(),
	size: z.enum(["sm", "md", "lg"]).default("md"),
	emphasis: z.enum(["normal", "rare", "epic", "legendary"]).default("normal"),
	effects: z.array(z.string().min(1)).default([]),
});

export const SpaceFileRefSchema = z.object({
	kind: z.literal("space-file"),
	path: z.string().min(1),
});

export const RemoteUrlRefSchema = z.object({
	kind: z.literal("remote-url"),
	url: z.string().url(),
});

export const CanvasResourceSnapshotSchema = z.object({
	title: z.string().optional(),
	mimeType: z.string().optional(),
	size: z.number().finite().nonnegative().optional(),
	mtimeMs: z.number().finite().nonnegative().optional(),
});

const CanvasItemBaseSchema = z.object({
	id: z.string().min(1),
	frame: CanvasFrameSchema,
	/** When true the shape cannot be moved, resized, or deleted. */
	locked: z.boolean().optional(),
	style: CanvasItemStyleSchema.optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CanvasResourceItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("resource"),
	ref: z.discriminatedUnion("kind", [SpaceFileRefSchema, RemoteUrlRefSchema]),
	snapshot: CanvasResourceSnapshotSchema.optional(),
});

export const CanvasTextItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("text"),
	text: z.string(),
});

// ─── New shape types ────────────────────────────────────────────────
// Colors are stored as palette ids (strings) rather than raw hex so themes can
// remap them and unknown future colors degrade gracefully at render time.

export const CanvasNoteItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("note"),
	text: z.string().default(""),
	color: z.string().min(1).default("brand"),
});

export const CanvasGeoItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("geo"),
	geo: z.string().min(1).default("rectangle"),
	text: z.string().default(""),
	color: z.string().min(1).default("brand"),
	fillOpacity: z.number().finite().min(0).max(1).default(0.12),
});

/** A raw freehand sample. Pressure defaults to 0.5 (mouse) when absent. */
export const DrawPointSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	p: z.number().finite().min(0).max(1).default(0.5),
});

export const CanvasDrawItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("draw"),
	points: z.array(DrawPointSchema).default([]),
	color: z.string().min(1).default("brand"),
	size: z.number().finite().positive().default(4),
});

/** An arrow endpoint: a free point or a binding to another shape. */
export const ArrowEndpointSchema = z.union([
	z.object({
		kind: z.literal("point"),
		x: z.number().finite(),
		y: z.number().finite(),
	}),
	z.object({
		kind: z.literal("binding"),
		target: z.string().min(1),
		nx: z.number().finite().default(0.5),
		ny: z.number().finite().default(0.5),
		precise: z.boolean().default(true),
	}),
]);

export const CanvasArrowItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("arrow"),
	start: ArrowEndpointSchema,
	end: ArrowEndpointSchema,
	bend: z.number().finite().default(0),
	color: z.string().min(1).default("brand"),
	size: z.number().finite().positive().default(3),
	arrowStart: z.boolean().default(false),
	arrowEnd: z.boolean().default(true),
	label: z.string().default(""),
});

/** A frame container for organising shapes. Children are not nested in data —
 * membership is spatial (items whose center lies inside the frame). */
export const CanvasFrameItemSchema = CanvasItemBaseSchema.extend({
	type: z.literal("frame"),
	label: z.string().default("Frame"),
	color: z.string().min(1).default("neutral"),
});

/**
 * The set of shape types this client understands natively. Anything else is
 * preserved verbatim as an unknown item (see CanvasUnknownItem) so documents
 * authored by newer clients round-trip losslessly — data is never dropped or
 * silently downgraded just because this client predates a shape type.
 */
export const KNOWN_CANVAS_ITEM_TYPES = [
	"resource",
	"text",
	"note",
	"geo",
	"draw",
	"arrow",
	"frame",
] as const;

export type KnownCanvasItemType = (typeof KNOWN_CANVAS_ITEM_TYPES)[number];

/**
 * A forward-compatible carrier for shape types this client does not recognise.
 * Its discriminant is the literal `"unknown"` so the item union still narrows
 * cleanly on `type` (a catch-all with an open `type: string` would break
 * discriminated-union narrowing everywhere). The *real* type string and every
 * original field are preserved verbatim in `raw`, so serialisation and node
 * mapping reproduce the source exactly — data is never dropped or downgraded.
 */
export const UNKNOWN_CANVAS_ITEM_TYPE = "unknown" as const;

export type CanvasUnknownItem = {
	id: string;
	type: typeof UNKNOWN_CANVAS_ITEM_TYPE;
	frame: z.infer<typeof CanvasFrameSchema>;
	/** When true the shape cannot be moved, resized, or deleted. */
	locked?: boolean;
	style?: z.infer<typeof CanvasItemStyleSchema>;
	metadata?: Record<string, unknown>;
	/** Verbatim original item record (carries the real `type`), for lossless round-trip. */
	raw: Record<string, unknown>;
};

/** The real (preserved) type string of an unknown item. */
export function unknownRealType(item: CanvasUnknownItem): string {
	const real = item.raw.type;
	return typeof real === "string" && real ? real : "unknown";
}

/**
 * Lenient item schema: known types are validated and normalised, anything else
 * becomes a lossless unknown item (see parseCanvasItemLoose). Parsing a document
 * therefore never drops or rejects an item because of an unrecognised shape type.
 */
export const CanvasItemSchema = z
	.any()
	.transform((raw): CanvasItem => parseCanvasItemLoose(raw));

/**
 * Parse a single item leniently: known types are validated and normalised;
 * anything else becomes a lossless unknown item. Never throws on shape data —
 * a malformed known item degrades to unknown rather than failing the document.
 */
export function parseCanvasItemLoose(raw: unknown): CanvasItem {
	if (!raw || typeof raw !== "object") {
		return makeUnknownItem(raw);
	}
	const record = raw as Record<string, unknown>;
	const type = record.type;
	switch (type) {
		case "resource": {
			const parsed = CanvasResourceItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "text": {
			const parsed = CanvasTextItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "note": {
			const parsed = CanvasNoteItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "geo": {
			const parsed = CanvasGeoItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "draw": {
			const parsed = CanvasDrawItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "arrow": {
			const parsed = CanvasArrowItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		case "frame": {
			const parsed = CanvasFrameItemSchema.safeParse(raw);
			return parsed.success ? parsed.data : makeUnknownItem(raw);
		}
		default:
			return makeUnknownItem(raw);
	}
}

function makeUnknownItem(raw: unknown): CanvasUnknownItem {
	const record =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const frameParsed = CanvasFrameSchema.safeParse(record.frame);
	const styleParsed = CanvasItemStyleSchema.safeParse(record.style);
	return {
		id: typeof record.id === "string" && record.id ? record.id : "unknown",
		type: UNKNOWN_CANVAS_ITEM_TYPE,
		frame: frameParsed.success
			? frameParsed.data
			: { x: 0, y: 0, width: 120, height: 80, rotation: 0 },
		...(record.locked === true ? { locked: true } : {}),
		...(styleParsed.success && record.style ? { style: styleParsed.data } : {}),
		...(record.metadata && typeof record.metadata === "object"
			? { metadata: record.metadata as Record<string, unknown> }
			: {}),
		raw: record,
	};
}

export const CovasDocumentSchema = z.object({
	kind: z.literal(CANVAS_DOCUMENT_KIND),
	version: z.literal(1),
	appearance: CanvasAppearanceSchema.default({
		theme: "clean",
		background: { kind: "grid" },
		grid: { visible: true, size: 32, opacity: 0.22 },
		mood: "clean",
	}),
	viewport: CanvasViewportSchema,
	items: z.array(CanvasItemSchema),
});

export type CanvasFrame = z.infer<typeof CanvasFrameSchema>;
export type CanvasViewport = z.infer<typeof CanvasViewportSchema>;
export type CanvasAppearance = z.infer<typeof CanvasAppearanceSchema>;
export type CanvasItemStyle = z.infer<typeof CanvasItemStyleSchema>;
export type SpaceFileRef = z.infer<typeof SpaceFileRefSchema>;
export type RemoteUrlRef = z.infer<typeof RemoteUrlRefSchema>;
export type CanvasResourceSnapshot = z.infer<
	typeof CanvasResourceSnapshotSchema
>;
export type CanvasResourceItem = z.infer<typeof CanvasResourceItemSchema>;
export type CanvasTextItem = z.infer<typeof CanvasTextItemSchema>;
export type CanvasNoteItem = z.infer<typeof CanvasNoteItemSchema>;
export type CanvasGeoItem = z.infer<typeof CanvasGeoItemSchema>;
export type DrawPoint = z.infer<typeof DrawPointSchema>;
export type CanvasDrawItem = z.infer<typeof CanvasDrawItemSchema>;
export type ArrowEndpoint = z.infer<typeof ArrowEndpointSchema>;
export type CanvasArrowItem = z.infer<typeof CanvasArrowItemSchema>;
export type CanvasFrameItem = z.infer<typeof CanvasFrameItemSchema>;
/** Known (natively handled) item variants. */
export type CanvasKnownItem =
	| CanvasResourceItem
	| CanvasTextItem
	| CanvasNoteItem
	| CanvasGeoItem
	| CanvasDrawItem
	| CanvasArrowItem
	| CanvasFrameItem;
/** Any item, including forward-compatible unknown types. */
export type CanvasItem = CanvasKnownItem | CanvasUnknownItem;
export type CovasDocument = z.infer<typeof CovasDocumentSchema>;

/**
 * An item is "unknown" when its discriminant is the reserved `"unknown"` literal
 * (equivalently, it carries a preserved `raw` record). Either test works; the
 * literal keeps discriminated-union narrowing on `type` intact for known shapes.
 */
export function isUnknownItem(item: CanvasItem): item is CanvasUnknownItem {
	return item.type === UNKNOWN_CANVAS_ITEM_TYPE;
}
