import {
	CANVAS_DOCUMENT_KIND,
	type CanvasAppearance,
	CanvasAppearanceSchema,
	type CovasDocument,
	CovasDocumentSchema,
} from "$lib/canvas/canvas-schema";

export const DEFAULT_CANVAS_APPEARANCE: CanvasAppearance =
	CanvasAppearanceSchema.parse({
		theme: "clean",
		background: { kind: "grid" },
		grid: { visible: true, size: 32, opacity: 0.22 },
		mood: "clean",
	});

export function createEmptyCovasDocument(): CovasDocument {
	return CovasDocumentSchema.parse({
		kind: CANVAS_DOCUMENT_KIND,
		version: 1,
		appearance: DEFAULT_CANVAS_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: [],
	});
}

export function parseCovasDocument(
	content: string,
): { ok: true; document: CovasDocument } | { ok: false; error: string } {
	try {
		const raw = JSON.parse(content || "{}");
		const parsed = CovasDocumentSchema.safeParse(raw);
		if (!parsed.success) {
			return {
				ok: false,
				error: parsed.error.issues[0]?.message ?? "Invalid canvas document",
			};
		}
		return { ok: true, document: parsed.data };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Invalid JSON",
		};
	}
}

export function serializeCovasDocument(document: CovasDocument) {
	return `${JSON.stringify(CovasDocumentSchema.parse(document), null, 2)}\n`;
}
