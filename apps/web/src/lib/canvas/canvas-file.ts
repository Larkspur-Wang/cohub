import { COVAS_EXTENSION } from "$lib/canvas/canvas-schema";

export function isCovasFile(path: string) {
	return path.toLowerCase().endsWith(COVAS_EXTENSION);
}

export function ensureCovasExtension(name: string) {
	const trimmed = name.trim();
	return isCovasFile(trimmed) ? trimmed : `${trimmed}${COVAS_EXTENSION}`;
}

export function getCanvasTitle(path: string) {
	return path.split("/").pop() || "Untitled.covas";
}
