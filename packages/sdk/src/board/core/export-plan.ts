/**
 * Export planning — pure geometry, no renderer.
 *
 * Every platform (browser, CLI) resolves *what* to capture and *how large* the
 * result may be through this module, so a `--scale 4` on a huge board behaves
 * identically everywhere and no caller can accidentally ask the GPU for a
 * texture it cannot allocate.
 */

import {
  type BoardDocument,
  type BoardItem,
  parseBoardDocument,
} from "@cohub/protocol/board-document";
import type { BoardConnection } from "@cohub/protocol/board-connection";
import { itemBounds, type Rect, rectsIntersect, unionRects } from "../geometry.js";
import { arrowBounds } from "./arrow-geometry.js";
import {
  connectionBounds,
  type FrameLookup,
  resolveConnection,
} from "./connections.js";

/** What part of the board to capture. */
export type BoardExportRegion =
  /** Everything in the document. */
  | { kind: "all" }
  /** Exactly these items, whatever else overlaps them. */
  | { kind: "items"; ids: string[] }
  /** A frame item's rect, treated as a page: its chrome is excluded. */
  | { kind: "frame"; id: string }
  /** An explicit world-space rect. */
  | { kind: "rect"; rect: Rect };

export type BoardExportPlanInput = {
  document: BoardDocument;
  region: BoardExportRegion;
  /** Output pixels per world unit. Defaults to 2 (retina-grade). */
  scale?: number;
  /** World-space breathing room around the content. Frames use 0. */
  padding?: number;
  maxEdge?: number;
  maxPixels?: number;
};

export type BoardExportPlan = {
  /** World-space rect captured, padding included. */
  world: Rect;
  /** Scale actually used, after clamping. */
  scale: number;
  /** Scale asked for, before clamping. */
  requestedScale: number;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Items to draw, in document order. */
  items: BoardItem[];
  /**
   * Connections to draw.
   *
   * A relation is only included when both of its nodes are in `items`: half a
   * connection would render as a line into empty space, which reads as a defect
   * rather than as a clipped edge.
   */
  connections: BoardConnection[];
  /** True when `scale` had to be reduced to fit the size budget. */
  clamped: boolean;
};

/**
 * Normalise a document before it reaches the renderers.
 *
 * Renderers read shape fields directly and assume schema defaults have been
 * applied — a hand-built or partially-migrated document would otherwise reach
 * them with missing fields. Parsing here means every entry point (CLI, web,
 * tests) gets the same guarantee, and an invalid document fails with a schema
 * error instead of a render-time crash.
 */
export function normalizeBoardDocument(document: BoardDocument): BoardDocument {
  return parseBoardDocument(document);
}

/**
 * Hard ceilings.
 *
 * `MAX_EDGE` stays under the 8192 texture limit that essentially every WebGL2
 * and Canvas2D backend guarantees. `MAX_PIXELS` bounds peak memory instead of
 * edge length — a 8192×8192 RGBA buffer alone is 256MB, which is enough to kill
 * a browser tab, so the total is capped well below the square of the edge.
 */
export const BOARD_EXPORT_MAX_EDGE = 8192;
export const BOARD_EXPORT_MAX_PIXELS = 32_000_000;
export const BOARD_EXPORT_DEFAULT_SCALE = 2;
export const BOARD_EXPORT_DEFAULT_PADDING = 32;
/** Above this, an export is still produced but the caller is warned. */
export const BOARD_EXPORT_ITEM_WARN_THRESHOLD = 2000;

export function boardFrameLookup(document: BoardDocument): FrameLookup {
  const frames = new Map(document.items.map((item) => [item.id, item.frame]));
  return (id) => frames.get(id);
}

/** Bounds of a single item. Arrows resolve through their own curve geometry. */
export function exportItemBounds(item: BoardItem, _getFrame?: FrameLookup): Rect {
  if (item.type === "arrow") return arrowBounds(item);
  return itemBounds(item.frame);
}

/** Bounds of a connection, resolved against the document's node frames. */
export function exportConnectionBounds(
  connection: BoardConnection,
  getFrame: FrameLookup,
): Rect | null {
  const resolved = resolveConnection(connection, getFrame);
  return resolved ? connectionBounds(resolved, connection.style.size) : null;
}

/** Connections whose endpoints are both inside the given item set. */
function connectionsWithin(
  document: BoardDocument,
  items: BoardItem[],
): BoardConnection[] {
  if (document.connections.length === 0) return [];
  const present = new Set(items.map((item) => item.id));
  return document.connections.filter(
    (connection) =>
      present.has(connection.source.nodeId) && present.has(connection.target.nodeId),
  );
}

function resolveRegion(
  document: BoardDocument,
  region: BoardExportRegion,
  getFrame: FrameLookup,
): { items: BoardItem[]; connections: BoardConnection[]; rect: Rect | null; padding: number | null } {
  switch (region.kind) {
    case "all": {
      const connections = document.connections;
      return {
        items: document.items,
        connections,
        rect: unionRects([
          ...document.items.map((item) => exportItemBounds(item)),
          ...connectionBoundsList(connections, getFrame),
        ]),
        padding: null,
      };
    }
    case "items": {
      const wanted = new Set(region.ids);
      const items = document.items.filter((item) => wanted.has(item.id));
      const connections = connectionsWithin(document, items);
      return {
        items,
        connections,
        rect: unionRects([
          ...items.map((item) => exportItemBounds(item)),
          ...connectionBoundsList(connections, getFrame),
        ]),
        padding: null,
      };
    }
    case "frame": {
      const frame = document.items.find((item) => item.id === region.id);
      if (!frame) return { items: [], connections: [], rect: null, padding: null };
      const rect = itemBounds(frame.frame);
      // The frame's own dashed outline and label are editor scaffolding, not
      // content — a framed export should look like a page, not a screenshot.
      const items = document.items.filter(
        (item) => item.id !== region.id && rectsIntersect(exportItemBounds(item), rect),
      );
      return { items, connections: connectionsWithin(document, items), rect, padding: 0 };
    }
    case "rect": {
      const rect = region.rect;
      const items = document.items.filter((item) =>
        rectsIntersect(exportItemBounds(item), rect),
      );
      return { items, connections: connectionsWithin(document, items), rect, padding: 0 };
    }
  }
}

function connectionBoundsList(
  connections: readonly BoardConnection[],
  getFrame: FrameLookup,
): Rect[] {
  const rects: Rect[] = [];
  for (const connection of connections) {
    const bounds = exportConnectionBounds(connection, getFrame);
    if (bounds) rects.push(bounds);
  }
  return rects;
}

/**
 * Largest scale that keeps the output inside both the edge and pixel budgets.
 *
 * There is deliberately no lower bound: a floor here would silently let a very
 * large world exceed the budgets it exists to enforce (a 1e6×1e6 region at a
 * 0.01 floor is 1e8 pixels). Callers see the reduction via `plan.clamped`.
 */
function clampScale(
  requested: number,
  world: Rect,
  maxEdge: number,
  maxPixels: number,
): number {
  const byEdge = Math.min(maxEdge / world.width, maxEdge / world.height);
  const byArea = Math.sqrt(maxPixels / (world.width * world.height));
  return Math.min(requested, byEdge, byArea);
}

/**
 * Resolve a region into a concrete capture plan, or null when there is nothing
 * to draw. Callers treat null as "empty selection", not as an error.
 */
export function planBoardExport(input: BoardExportPlanInput): BoardExportPlan | null {
  const {
    region,
    scale: requestedScale = BOARD_EXPORT_DEFAULT_SCALE,
    maxEdge = BOARD_EXPORT_MAX_EDGE,
    maxPixels = BOARD_EXPORT_MAX_PIXELS,
  } = input;
  // Planning reads optional groups (connections, per-shape defaults), so the
  // document is normalised first. That makes a hand-built or partial document a
  // supported input for every entry point rather than a source of shape-dependent
  // crashes deep in the region resolver.
  const document = normalizeBoardDocument(input.document);
  const getFrame = boardFrameLookup(document);
  const resolved = resolveRegion(document, region, getFrame);
  if (!resolved.rect) return null;

  const padding = input.padding ?? resolved.padding ?? BOARD_EXPORT_DEFAULT_PADDING;
  const world: Rect = {
    x: resolved.rect.x - padding,
    y: resolved.rect.y - padding,
    width: Math.max(1, resolved.rect.width + padding * 2),
    height: Math.max(1, resolved.rect.height + padding * 2),
  };

  // A positive requested scale is all that is required; the budgets below decide
  // how much of it survives.
  const safeRequest = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : BOARD_EXPORT_DEFAULT_SCALE;
  const scale = clampScale(safeRequest, world, maxEdge, maxPixels);
  return {
    world,
    scale,
    requestedScale,
    // Floor, not round: rounding up can push a budget-limited export back over
    // the pixel ceiling it was just clamped to.
    width: Math.max(1, Math.floor(world.width * scale)),
    height: Math.max(1, Math.floor(world.height * scale)),
    items: resolved.items,
    connections: resolved.connections,
    clamped: scale < safeRequest - 1e-6,
  };
}
