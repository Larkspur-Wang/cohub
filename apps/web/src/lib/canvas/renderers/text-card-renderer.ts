import type { CanvasItem } from "$lib/canvas/canvas-schema";
import { createBaseCard } from "$lib/canvas/renderers/base-card-renderer";
import type { CanvasCardRenderer } from "$lib/canvas/renderers/canvas-renderer-registry";

export const textCardRenderer: CanvasCardRenderer = {
	id: "text-card",
	canRender: (item: CanvasItem) => item.type === "text",
	create: (item, context) =>
		createBaseCard(item, context, {
			badge: "TXT",
			body: item.type === "text" ? item.text : "Text",
		}),
};
