import type {
	CanvasDocumentRecord,
	CanvasNodeInput,
	CanvasNodeRecord,
} from "@neta-art/cohub";
import {
	CANVAS_DOCUMENT_KIND,
	type CanvasAppearance,
	CanvasAppearanceSchema,
	type CanvasItem,
	type CanvasResourceSnapshot,
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

export type CovasManifest = {
	kind: "cohub.canvas.manifest";
	version: 1;
	documentId: string;
	title: string;
};

export function parseCovasManifest(content: string): CovasManifest | null {
	try {
		const raw = JSON.parse(content || "{}");
		if (
			raw?.kind === "cohub.canvas.manifest" &&
			raw.version === 1 &&
			typeof raw.documentId === "string" &&
			typeof raw.title === "string"
		)
			return raw as CovasManifest;
		return null;
	} catch {
		return null;
	}
}

export function canvasNodeToItem(node: CanvasNodeRecord): CanvasItem {
	const frame = {
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		rotation: node.rotation,
	};
	const style = Object.keys(node.style ?? {}).length
		? (node.style as CanvasItem["style"])
		: undefined;
	if (node.type === "text") {
		return {
			id: node.nodeId,
			type: "text",
			text: typeof node.data?.text === "string" ? node.data.text : "Text",
			frame,
			style,
		};
	}
	if (node.refKind === "remote_url" && node.refUrl) {
		return {
			id: node.nodeId,
			type: "resource",
			ref: { kind: "remote-url", url: node.refUrl },
			snapshot: node.view as CanvasResourceSnapshot,
			frame,
			style,
		};
	}
	return {
		id: node.nodeId,
		type: "resource",
		ref: { kind: "space-file", path: node.refPath || "missing" },
		snapshot: node.view as CanvasResourceSnapshot,
		frame,
		style,
	};
}

export function canvasItemToNode(
	item: CanvasItem,
	index: number,
): CanvasNodeInput {
	const base = {
		nodeId: item.id,
		type: item.type === "text" ? "text" : "file",
		parentId: null,
		orderKey: String(index).padStart(8, "0"),
		x: item.frame.x,
		y: item.frame.y,
		width: item.frame.width,
		height: item.frame.height,
		rotation: item.frame.rotation,
		view: item.type === "resource" ? (item.snapshot ?? {}) : {},
		style: item.style ?? {},
		animation: {},
		data: item.type === "text" ? { text: item.text } : {},
	};
	if (item.type === "text")
		return { ...base, refKind: null, refPath: null, refUrl: null };
	return item.ref.kind === "space-file"
		? { ...base, refKind: "space_file", refPath: item.ref.path, refUrl: null }
		: {
				...base,
				type: "url",
				refKind: "remote_url",
				refPath: null,
				refUrl: item.ref.url,
			};
}

export function canvasBootstrapToDocument(input: {
	document: CanvasDocumentRecord;
	nodes: CanvasNodeRecord[];
}): CovasDocument {
	return CovasDocumentSchema.parse({
		kind: CANVAS_DOCUMENT_KIND,
		version: 1,
		appearance: DEFAULT_CANVAS_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: input.nodes.map(canvasNodeToItem),
	});
}
