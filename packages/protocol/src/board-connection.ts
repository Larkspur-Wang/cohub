/**
 * Board connections — the first-class relation between two Board nodes.
 *
 * A connection is *not* a shape. It has no frame of its own: its geometry is
 * derived entirely from the two nodes it joins, which is exactly why it belongs
 * in its own entity rather than in the item list. Storing it as a node would
 * force a bounding box to be persisted and kept in sync with both endpoints —
 * a second source of truth that is stale the moment either node moves.
 *
 * The stored form is therefore purely semantic: which nodes, in which direction,
 * anchored where, routed how. Every world coordinate is resolved at read time
 * from the live node frames (see the SDK's connection geometry), so a connection
 * can never drift from the nodes it describes.
 *
 * Agents read this model directly: `source`, `target`, `relation` and `label`
 * carry the meaning, while `routing` and `style` carry only presentation. A
 * reader that wants the graph never has to interpret pixels.
 */

import { z } from "zod";
import {
  BOARD_CONNECTION_STROKE_SIZE,
  clampBoardStrokeSize,
} from "./board-constants.js";

/** Sides of a node frame a connection can attach to. */
export const BOARD_CONNECTION_SIDES = ["top", "right", "bottom", "left"] as const;
export type BoardConnectionSide = (typeof BOARD_CONNECTION_SIDES)[number];

/**
 * Where a connection meets its node.
 *
 * - `auto` — the side is chosen from the live geometry of both endpoints, so the
 *   connection stays sensible through any move or resize. This is the default and
 *   what almost every connection should use.
 * - `side` — the user pinned a side; `offset` (0..1) positions it along that edge.
 * - `fixed` — the user pinned an exact normalized point on the frame.
 *
 * `auto` is a *declaration of intent*, not a computed value: the resolved side is
 * never written back, so the connection keeps adapting instead of freezing the
 * first layout it happened to have.
 */
export const BoardConnectionAnchorSchema = z.union([
  z.object({ kind: z.literal("auto") }),
  z.object({
    kind: z.literal("side"),
    side: z.enum(BOARD_CONNECTION_SIDES),
    offset: z.number().finite().min(0).max(1).default(0.5),
  }),
  z.object({
    kind: z.literal("fixed"),
    nx: z.number().finite().min(0).max(1),
    ny: z.number().finite().min(0).max(1),
  }),
]);

export type BoardConnectionAnchor = z.infer<typeof BoardConnectionAnchorSchema>;

export const AUTO_BOARD_CONNECTION_ANCHOR: BoardConnectionAnchor = { kind: "auto" };

export const BoardConnectionEndpointSchema = z.object({
  nodeId: z.string().min(1).max(160),
  /** Optional semantic port. Older connections omit it and remain valid. */
  portId: z.string().min(1).max(120).optional(),
  anchor: BoardConnectionAnchorSchema.default(AUTO_BOARD_CONNECTION_ANCHOR),
});

export type BoardConnectionEndpoint = z.infer<typeof BoardConnectionEndpointSchema>;

/**
 * Which ends carry an arrowhead.
 *
 * This is the *semantic* direction, not a style flag: `forward` means the
 * relation reads source → target, `backward` means target → source, and `none`
 * means the relation is symmetric. Renderers derive arrowheads from it, so the
 * drawing can never disagree with the meaning.
 */
export const BOARD_CONNECTION_DIRECTIONS = ["none", "forward", "backward", "both"] as const;
export type BoardConnectionDirection = (typeof BOARD_CONNECTION_DIRECTIONS)[number];

/** How the line travels between its two resolved endpoints. */
export const BOARD_CONNECTION_ROUTINGS = ["straight", "curve", "orthogonal"] as const;
export type BoardConnectionRouting = (typeof BOARD_CONNECTION_ROUTINGS)[number];

export const BOARD_CONNECTION_LINES = ["solid", "dashed"] as const;
export type BoardConnectionLine = (typeof BOARD_CONNECTION_LINES)[number];

/**
 * The default relation kind.
 *
 * "related" is deliberately unopinionated: drawing a line between two nodes
 * states that they are connected, not *how*. A stronger claim (depends-on,
 * blocks, ...) is something the user or an agent asserts explicitly.
 */
export const DEFAULT_BOARD_RELATION = "related" as const;

/**
 * Relation kind — a free-form slug, not an enum.
 *
 * Boards are used for domains we do not control, so a closed vocabulary would
 * force unrelated meanings into the wrong bucket. The format is constrained
 * (lowercase, dash/dot separated) so relations stay comparable and queryable
 * across clients instead of accumulating near-duplicate spellings.
 */
export const BoardRelationSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "relation must be a lowercase slug")
  .default(DEFAULT_BOARD_RELATION);

/**
 * Waypoints a user dragged the line through, in world space.
 *
 * Stored because they are *input*, not output: the resolved path is recomputed
 * from them on every read, but the intent behind a hand-routed line cannot be
 * recovered once discarded.
 */
export const BoardConnectionWaypointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const BoardConnectionRoutingSchema = z.object({
  kind: z.enum(BOARD_CONNECTION_ROUTINGS).default("curve"),
  /** Curve bow as a fraction of endpoint distance (-0.85..0.85). */
  bend: z.number().finite().min(-0.85).max(0.85).default(0),
  waypoints: z.array(BoardConnectionWaypointSchema).max(64).default([]),
});

export type BoardConnectionRoutingConfig = z.infer<typeof BoardConnectionRoutingSchema>;

export const BoardConnectionStyleSchema = z.object({
  /** Palette color id, resolved to a theme token at render time. */
  color: z.string().min(1).max(40).default("brand"),
  size: z.number().finite().positive().default(BOARD_CONNECTION_STROKE_SIZE),
  line: z.enum(BOARD_CONNECTION_LINES).default("solid"),
});

export type BoardConnectionStyle = z.infer<typeof BoardConnectionStyleSchema>;

export const DEFAULT_BOARD_CONNECTION_ROUTING: BoardConnectionRoutingConfig = {
  kind: "curve",
  bend: 0,
  waypoints: [],
};

export const DEFAULT_BOARD_CONNECTION_STYLE: BoardConnectionStyle = {
  color: "brand",
  size: BOARD_CONNECTION_STROKE_SIZE,
  line: "solid",
};

export const BoardConnectionSchema = z.object({
  id: z.string().min(1).max(160),
  source: BoardConnectionEndpointSchema,
  target: BoardConnectionEndpointSchema,
  relation: BoardRelationSchema,
  direction: z.enum(BOARD_CONNECTION_DIRECTIONS).default("forward"),
  label: z.string().max(280).default(""),
  routing: BoardConnectionRoutingSchema.default(DEFAULT_BOARD_CONNECTION_ROUTING),
  style: BoardConnectionStyleSchema.default(DEFAULT_BOARD_CONNECTION_STYLE),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type BoardConnection = z.infer<typeof BoardConnectionSchema>;

/** Server-owned fields, mirroring how nodes carry a board id and revision. */
export type BoardConnectionRecord = BoardConnection & {
  boardId: string;
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
};

/** The client-authored form of a connection (no server-owned fields). */
export type BoardConnectionInput = BoardConnection;

/**
 * A patch to an existing connection.
 *
 * `id` is excluded: a connection's identity never changes, and re-pointing both
 * endpoints is an edit of the same relation, not a new one.
 */
export const BoardConnectionPatchSchema = BoardConnectionSchema.omit({ id: true }).partial();

export type BoardConnectionPatch = z.infer<typeof BoardConnectionPatchSchema>;

/** Both node ids a connection touches, deduped for a self-loop. */
export function connectionNodeIds(connection: BoardConnection): string[] {
  return connection.source.nodeId === connection.target.nodeId
    ? [connection.source.nodeId]
    : [connection.source.nodeId, connection.target.nodeId];
}

/** Whether a connection touches the given node. */
export function connectionTouchesNode(connection: BoardConnection, nodeId: string): boolean {
  return connection.source.nodeId === nodeId || connection.target.nodeId === nodeId;
}

/** The node at the far end of a connection from `nodeId`, or null. */
export function connectionOtherNodeId(
  connection: BoardConnection,
  nodeId: string,
): string | null {
  if (connection.source.nodeId === nodeId) return connection.target.nodeId;
  if (connection.target.nodeId === nodeId) return connection.source.nodeId;
  return null;
}

export function normalizeBoardConnectionStyle(
  style: Partial<BoardConnectionStyle> | undefined,
): BoardConnectionStyle {
  return {
    color: style?.color?.trim() || DEFAULT_BOARD_CONNECTION_STYLE.color,
    size: clampBoardStrokeSize(
      typeof style?.size === "number" && Number.isFinite(style.size)
        ? style.size
        : DEFAULT_BOARD_CONNECTION_STYLE.size,
    ),
    line: style?.line ?? DEFAULT_BOARD_CONNECTION_STYLE.line,
  };
}

/**
 * Build a connection with every default filled in.
 *
 * Callers only state what they mean (which nodes, and optionally the relation),
 * so a connection created by the editor, an agent or the CLI is byte-identical
 * for the same intent.
 */
export function createBoardConnection(input: {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation?: string;
  direction?: BoardConnectionDirection;
  label?: string;
  sourcePortId?: string;
  targetPortId?: string;
  sourceAnchor?: BoardConnectionAnchor;
  targetAnchor?: BoardConnectionAnchor;
  routing?: Partial<BoardConnectionRoutingConfig>;
  style?: Partial<BoardConnectionStyle>;
  metadata?: Record<string, unknown>;
}): BoardConnection {
  return {
    id: input.id,
    source: {
      nodeId: input.sourceNodeId,
      ...(input.sourcePortId ? { portId: input.sourcePortId } : {}),
      anchor: input.sourceAnchor ?? AUTO_BOARD_CONNECTION_ANCHOR,
    },
    target: {
      nodeId: input.targetNodeId,
      ...(input.targetPortId ? { portId: input.targetPortId } : {}),
      anchor: input.targetAnchor ?? AUTO_BOARD_CONNECTION_ANCHOR,
    },
    relation: input.relation ?? DEFAULT_BOARD_RELATION,
    direction: input.direction ?? "forward",
    label: input.label ?? "",
    routing: { ...DEFAULT_BOARD_CONNECTION_ROUTING, ...input.routing },
    style: normalizeBoardConnectionStyle(input.style),
    metadata: input.metadata ?? {},
  };
}

/** Reverse a connection's endpoints, preserving the relation's reading order. */
export function flipBoardConnection(connection: BoardConnection): BoardConnection {
  const direction: BoardConnectionDirection =
    connection.direction === "forward"
      ? "backward"
      : connection.direction === "backward"
        ? "forward"
        : connection.direction;
  return {
    ...connection,
    source: connection.target,
    target: connection.source,
    direction,
    // The bow is measured from source to target, so flipping the ends mirrors it.
    routing: {
      ...connection.routing,
      bend: -connection.routing.bend,
      waypoints: [...connection.routing.waypoints].reverse(),
    },
  };
}
