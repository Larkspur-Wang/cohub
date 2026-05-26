import { inferMediaKind } from "$lib/canvas/canvas-media";
import type { CanvasItem } from "$lib/canvas/canvas-schema";
import {
	createBaseCard,
	subtitleForCanvasItem,
} from "$lib/canvas/renderers/base-card-renderer";
import type { CanvasCardRenderer } from "$lib/canvas/renderers/canvas-renderer-registry";

export const resourceCardRenderer: CanvasCardRenderer = {
	id: "resource-card",
	canRender: (item: CanvasItem) => item.type === "resource",
	create: (item, context) => {
		const badge =
			item.type === "resource"
				? inferMediaKind(
						item.ref.kind === "space-file" ? item.ref.path : item.ref.url,
						item.snapshot?.mimeType,
					).toUpperCase()
				: "FILE";
		return createBaseCard(item, context, {
			badge,
			body: subtitleForCanvasItem(item),
		});
	},
};
