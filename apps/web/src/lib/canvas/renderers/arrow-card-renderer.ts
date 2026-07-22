import { Container, Graphics, Text } from "pixi.js";
import { getCanvasResolution } from "$lib/canvas/canvas-rendering";
import type { CanvasArrowItem, CanvasFrame } from "$lib/canvas/canvas-schema";
import { resolveArrow, sampleQuadratic } from "$lib/canvas/core/bindings";
import { pickCanvasColor } from "$lib/canvas/core/palette";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

type ArrowParts = {
	root: Container;
	line: Graphics;
	label: Text;
	sig: string;
};

const partsByContainer = new WeakMap<Container, ArrowParts>();

/** Frame lookup over the current document, for resolving bindings. */
function frameLookup(context: CanvasRenderContext) {
	const byId = new Map<string, CanvasFrame>();
	for (const item of context.document.items) byId.set(item.id, item.frame);
	return (id: string) => byId.get(id);
}

/** Open chevron arrowhead — clearly directional, not a tiny filled nub. */
function drawArrowhead(
	graphics: Graphics,
	tip: { x: number; y: number },
	angle: number,
	size: number,
	color: number,
	strokeWidth: number,
) {
	const spread = Math.PI / 6;
	const left = {
		x: tip.x - size * Math.cos(angle - spread),
		y: tip.y - size * Math.sin(angle - spread),
	};
	const right = {
		x: tip.x - size * Math.cos(angle + spread),
		y: tip.y - size * Math.sin(angle + spread),
	};
	graphics
		.moveTo(left.x, left.y)
		.lineTo(tip.x, tip.y)
		.lineTo(right.x, right.y)
		.stroke({
			color,
			width: Math.max(1.5, strokeWidth),
			alpha: 1,
			cap: "round",
			join: "round",
		});
}

function sync(
	container: Container,
	item: CanvasArrowItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	// Arrows are positioned in world space (their geometry is absolute), so the
	// root sits at the origin with no frame transform.
	parts.root.position.set(0, 0);
	parts.root.rotation = 0;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickCanvasColor(context.colors, item.color, context.colorMode);

	const getFrame = frameLookup(context);
	const resolved = resolveArrow(item, getFrame);

	// Signature includes the resolved endpoints so the line tracks bound targets.
	const sig = resolved
		? [
				resolved.start.x,
				resolved.start.y,
				resolved.end.x,
				resolved.end.y,
				resolved.control.x,
				resolved.control.y,
				selected,
				hovered,
				item.color,
				item.size,
				item.arrowStart,
				item.arrowEnd,
				item.label,
				context.colorMode,
				context.colors.brand.stroke,
			].join("|")
		: `empty|${item.id}`;
	if (sig === parts.sig) return;
	parts.sig = sig;

	parts.line.clear();
	if (!resolved) return;

	const strokeColor = color.stroke;
	const width = selected ? item.size + 1 : item.size;
	const samples = sampleQuadratic(resolved, 24);
	parts.line.moveTo(samples[0].x, samples[0].y);
	for (let i = 1; i < samples.length; i += 1)
		parts.line.lineTo(samples[i].x, samples[i].y);
	parts.line.stroke({
		color: strokeColor,
		width,
		alpha: selected || hovered ? 1 : 0.92,
		cap: "round",
		join: "round",
	});

	// Head scales with stroke and arrow length so short arrows still read clearly.
	const span = Math.hypot(
		samples[samples.length - 1].x - samples[0].x,
		samples[samples.length - 1].y - samples[0].y,
	);
	const headSize = Math.min(
		Math.max(14, item.size * 5.5),
		Math.max(10, span * 0.28),
	);
	if (item.arrowEnd) {
		const prev = samples[samples.length - 2];
		const tip = samples[samples.length - 1];
		if (prev)
			drawArrowhead(
				parts.line,
				tip,
				Math.atan2(tip.y - prev.y, tip.x - prev.x),
				headSize,
				strokeColor,
				width,
			);
	}
	if (item.arrowStart) {
		const next = samples[1];
		const tip = samples[0];
		if (next)
			drawArrowhead(
				parts.line,
				tip,
				Math.atan2(tip.y - next.y, tip.x - next.x),
				headSize,
				strokeColor,
				width,
			);
	}

	if (parts.label.text !== item.label) parts.label.text = item.label;
	parts.label.visible = item.label.length > 0;
	parts.label.style.fill = color.label;
	parts.label.x = resolved.control.x - parts.label.width / 2;
	parts.label.y = resolved.control.y - parts.label.height / 2;
}

export const arrowCardRenderer: CanvasCardRenderer = {
	id: "arrow-card",
	canRender: (item) => item.type === "arrow",
	create: (item, context) => {
		const root = new Container();
		const line = new Graphics();
		const label = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontFamily: "Geist",
				fontSize: 12,
				fontWeight: "500",
			},
			resolution: getCanvasResolution(),
			roundPixels: true,
		});
		root.addChild(line, label);
		partsByContainer.set(root, { root, line, label, sig: "" });
		if (item.type === "arrow") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "arrow") sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
