import { DOMAdapter, type ICanvas } from "pixi.js";

const CACHE_LIMIT = 256;
const cache = new Map<string, number | null>();
let canvas: ICanvas | null = null;

export function parseBoardCssColor(value: string): number | null {
  const key = value.trim();
  if (!key) return null;
  const cached = cache.get(key);
  if (cached !== undefined || cache.has(key)) return cached ?? null;

  let result: number | null = null;
  try {
    const direct = /^#([0-9a-f]{6})$/i.exec(key);
    if (direct?.[1]) {
      result = Number.parseInt(direct[1], 16);
    } else {
      canvas ??= DOMAdapter.get().createCanvas(1, 1);
      const context = canvas.getContext("2d") as
        | { fillStyle: string | CanvasGradient | CanvasPattern }
        | null;
      if (context) {
        context.fillStyle = "#010203";
        context.fillStyle = key;
        const first = String(context.fillStyle);
        context.fillStyle = "#040506";
        context.fillStyle = key;
        const second = String(context.fillStyle);
        const match = first === second ? /^#([0-9a-f]{6})$/i.exec(first) : null;
        if (match?.[1]) result = Number.parseInt(match[1], 16);
      }
    }
  } catch {
    result = null;
  }

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}
