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

export const CanvasItemSchema = z.discriminatedUnion("type", [
	CanvasResourceItemSchema,
	CanvasTextItemSchema,
]);

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
export type CanvasItem = z.infer<typeof CanvasItemSchema>;
export type CovasDocument = z.infer<typeof CovasDocumentSchema>;
