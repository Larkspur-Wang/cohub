/**
 * SVG export — pure string builders per shape.
 *
 * No Pixi dependency: exports are driven by the same geometric facts the
 * editor uses (frames, endpoints, stroke points).
 */

import { itemBounds } from "$lib/canvas/canvas-geometry";
import type {
	CanvasArrowItem,
	CanvasDrawItem,
	CanvasFrame,
	CanvasGeoItem,
	CanvasItem,
	CanvasNoteItem,
	CanvasTextItem,
} from "$lib/canvas/canvas-schema";
import {
	arrowBounds,
	type FrameLookup,
	resolveArrow,
} from "$lib/canvas/core/bindings";
import { buildStrokeOutline } from "$lib/canvas/core/draw-geometry";
import { resolveCanvasColor } from "$lib/canvas/core/palette";

const ESC: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

function escapeXml(value: string) {
	return value.replace(/[&<>"']/g, (ch) => ESC[ch] ?? ch);
}

function colorHex(id: string, mode: "light" | "dark" = "dark"): string {
	const color = resolveCanvasColor(id, mode);
	return `#${color.stroke.toString(16).padStart(6, "0")}`;
}

function transformAttr(frame: CanvasFrame): string {
	if (!frame.rotation) return "";
	const cx = frame.x + frame.width / 2;
	const cy = frame.y + frame.height / 2;
	return ` transform="rotate(${frame.rotation} ${cx} ${cy})"`;
}

function exportText(item: CanvasTextItem): string {
	const { frame, text } = item;
	const stroke = colorHex(item.color || "neutral");
	const lines = escapeXml(text || "").split("\n");
	const tspans = lines
		.map(
			(line, index) =>
				`<tspan x="${frame.x}" dy="${index === 0 ? 0 : 24}">${line || " "}</tspan>`,
		)
		.join("");
	// Transparent freestanding text — no card chrome.
	return `<g${transformAttr(frame)}><text x="${frame.x}" y="${frame.y + 18}" fill="${stroke}" font-family="Geist, system-ui, sans-serif" font-size="18" font-weight="500">${tspans}</text></g>`;
}

function exportNote(item: CanvasNoteItem): string {
	const fill = colorHex(item.color);
	const { frame, text } = item;
	const lines = escapeXml(text || "Note").split("\n");
	const tspans = lines
		.map(
			(line, index) =>
				`<tspan x="${frame.x + 12}" dy="${index === 0 ? 0 : 18}">${line || " "}</tspan>`,
		)
		.join("");
	return `<g${transformAttr(frame)}><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="12" fill="${fill}" fill-opacity="0.18" stroke="${fill}" stroke-width="1.5"/><text x="${frame.x + 12}" y="${frame.y + 28}" fill="${fill}" font-family="Geist, system-ui, sans-serif" font-size="14" font-weight="600">${tspans}</text></g>`;
}

function exportGeo(item: CanvasGeoItem): string {
	const stroke = colorHex(item.color);
	const { frame, geo, fillOpacity } = item;
	const { x, y, width, height } = frame;
	const fill = `fill="${stroke}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="2"`;
	const body = (() => {
		switch (geo) {
			case "ellipse":
				return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${fill}/>`;
			case "diamond": {
				const cx = x + width / 2;
				const cy = y + height / 2;
				return `<polygon points="${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}" ${fill}/>`;
			}
			case "triangle": {
				const cx = x + width / 2;
				return `<polygon points="${cx},${y} ${x + width},${y + height} ${x},${y + height}" ${fill}/>`;
			}
			case "rounded":
				return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" ${fill}/>`;
			default:
				return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" ${fill}/>`;
		}
	})();
	return `<g${transformAttr(frame)}>${body}</g>`;
}

function arrowHead(
	tip: { x: number; y: number },
	from: { x: number; y: number },
	size: number,
	stroke: string,
): string {
	const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
	const head = Math.max(14, size * 5.5);
	const spread = Math.PI / 6;
	const leftX = tip.x - head * Math.cos(angle - spread);
	const leftY = tip.y - head * Math.sin(angle - spread);
	const rightX = tip.x - head * Math.cos(angle + spread);
	const rightY = tip.y - head * Math.sin(angle + spread);
	return `<path d="M${leftX} ${leftY} L${tip.x} ${tip.y} L${rightX} ${rightY}" fill="none" stroke="${stroke}" stroke-width="${Math.max(1.5, size)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function exportDraw(item: CanvasDrawItem): string {
	const stroke = colorHex(item.color);
	// Points are local to the frame; build the outline in local space, then wrap
	// with the frame transform (translate + optional rotation) once.
	const outline = buildStrokeOutline(item.points, item.size);
	if (outline.length < 3) return "";
	const d = outline
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
		.join(" ");
	const rotate = item.frame.rotation
		? ` rotate(${item.frame.rotation} ${item.frame.width / 2} ${item.frame.height / 2})`
		: "";
	return `<g transform="translate(${item.frame.x} ${item.frame.y})${rotate}"><path d="${d} Z" fill="${stroke}" fill-opacity="0.92"/></g>`;
}

function exportArrow(item: CanvasArrowItem, getFrame: FrameLookup): string {
	const resolved = resolveArrow(item, getFrame);
	if (!resolved) return "";
	const stroke = colorHex(item.color);
	const { start, end, control } = resolved;
	const d = `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}`;
	const heads =
		(item.arrowStart ? arrowHead(start, control, item.size, stroke) : "") +
		(item.arrowEnd ? arrowHead(end, control, item.size, stroke) : "");
	return `<g><path d="${d}" fill="none" stroke="${stroke}" stroke-width="${item.size}" stroke-linecap="round"/>${heads}</g>`;
}

function exportFrame(item: CanvasItem): string {
	if (item.type !== "frame") return "";
	const { frame, label, color } = item;
	const stroke = colorHex(color || "neutral");
	return `<g><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="4" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${frame.x + 4}" y="${frame.y - 6}" fill="${stroke}" font-family="Geist, system-ui, sans-serif" font-size="12">${escapeXml(label || "Frame")}</text></g>`;
}

function exportGeneric(item: CanvasItem): string {
	const box = itemBounds(item.frame);
	return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="#2a2a2a" stroke="#3a3a3a" stroke-width="1"/>`;
}

export function itemToSvg(item: CanvasItem, getFrame: FrameLookup): string {
	switch (item.type) {
		case "text":
			return exportText(item);
		case "note":
			return exportNote(item);
		case "geo":
			return exportGeo(item);
		case "draw":
			return exportDraw(item);
		case "arrow":
			return exportArrow(item, getFrame);
		case "frame":
			return exportFrame(item);
		case "image":
		case "video":
			return exportGeneric(item);
		default:
			return exportGeneric(item);
	}
}

export function itemsToSvg(
	items: CanvasItem[],
	getFrame: FrameLookup,
	padding = 24,
): string {
	if (items.length === 0) return "";
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const item of items) {
		const box =
			item.type === "arrow"
				? (arrowBounds(item, getFrame) ?? itemBounds(item.frame))
				: itemBounds(item.frame);
		minX = Math.min(minX, box.x);
		minY = Math.min(minY, box.y);
		maxX = Math.max(maxX, box.x + box.width);
		maxY = Math.max(maxY, box.y + box.height);
	}
	const width = Math.max(1, maxX - minX + padding * 2);
	const height = Math.max(1, maxY - minY + padding * 2);
	const body = items
		.map((item) => itemToSvg(item, getFrame))
		.filter(Boolean)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX - padding} ${minY - padding} ${width} ${height}">\n${body}\n</svg>`;
}
