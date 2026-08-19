import { z } from "zod";
import type {
  BoardCapability,
  BoardCoordinateSpace,
  BoardRenderCost,
} from "./board-constants.js";
import {
  BoardConnectionSchema,
  type BoardConnectionInput,
  type BoardConnectionPatch,
  type BoardConnectionRecord,
} from "./board-connection.js";
import { BoardCompositionInputSchema } from "./board-composition.js";
import { BoardAuthoringItemSchema } from "./board-authoring.js";
import type {
  BOARD_ANIMATION_CHANNEL_CAPABILITIES,
  BoardComposition,
} from "./board-composition.js";
import type { BoardNodeContract } from "./board-node.js";

export {
  BOARD_BUILTIN_CAPABILITIES,
  BOARD_BUILTIN_CLIP_KINDS,
  BOARD_BUILTIN_EFFECT_KINDS,
  DEFAULT_BOARD_RENDER_LIMITS,
  type BoardCapability,
  type BoardCoordinateSpace,
  type BoardRenderCost,
} from "./board-constants.js";

export const BOARD_EXTENSION = ".board" as const;
export const BOARD_MIME_TYPE = "application/json" as const;
export const BOARD_DOCUMENT_KIND = "cohub.board" as const;
export const BOARD_MANIFEST_KIND = "cohub.board.manifest" as const;
export const BOARD_CHECKPOINT_KIND = "cohub.board.checkpoint" as const;
export const BOARD_SNAPSHOT_KIND = "cohub.board.snapshot" as const;
export const BOARD_CLIPBOARD_KIND = "cohub.board.clipboard" as const;
export const BOARD_CLIPBOARD_MIME = "application/x-cohub-board" as const;
export const BOARD_MANIFEST_VERSION = 1 as const;
export const BOARD_PROTOCOL_VERSION = 2 as const;

const idSchema = z.string().min(1).max(160);
const extensionIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/).max(160);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const finiteSchema = z.number().finite();

export const BoardManifestSchema = z.object({
  kind: z.literal(BOARD_MANIFEST_KIND),
  version: z.literal(BOARD_MANIFEST_VERSION),
  boardId: z.string().uuid(),
  title: z.string().min(1).max(255),
});

export type BoardManifest = z.infer<typeof BoardManifestSchema>;

export class InvalidBoardFileError extends Error {
  readonly code = "INVALID_BOARD_FILE";

  constructor(message = "Board file is invalid") {
    super(message);
    this.name = "InvalidBoardFileError";
  }
}

export function parseBoardManifest(input: string | unknown): BoardManifest {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new InvalidBoardFileError("Board file must contain valid JSON");
    }
  }
  const parsed = BoardManifestSchema.safeParse(value);
  if (!parsed.success) throw new InvalidBoardFileError("Board file must contain a valid boardId");
  return parsed.data;
}

export function serializeBoardManifest(manifest: BoardManifest): string {
  return `${JSON.stringify(BoardManifestSchema.parse(manifest), null, 2)}\n`;
}

export const BoardCameraStateSchema = z.object({
  centerX: finiteSchema,
  centerY: finiteSchema,
  zoom: finiteSchema.positive(),
});

export const BoardCameraFocusSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rect"),
    rect: z.object({
      x: finiteSchema,
      y: finiteSchema,
      width: finiteSchema.positive(),
      height: finiteSchema.positive(),
    }),
  }),
  z.object({ type: z.literal("item"), itemId: idSchema }),
  z.object({ type: z.literal("items"), itemIds: z.array(idSchema).min(1).max(1_000) }),
  z.object({ type: z.literal("frame"), frameId: idSchema }),
]);

export const BoardCameraFocusParamsSchema = z.object({
  focus: BoardCameraFocusSchema,
  fit: z.enum(["contain", "cover"]).default("contain"),
  padding: finiteSchema.nonnegative().default(32),
  minZoom: finiteSchema.positive().optional(),
  maxZoom: finiteSchema.positive().optional(),
}).superRefine((value, context) => {
  if (
    value.minZoom !== undefined &&
    value.maxZoom !== undefined &&
    value.minZoom > value.maxZoom
  ) {
    context.addIssue({
      code: "custom",
      message: "minZoom must not exceed maxZoom",
      path: ["minZoom"],
    });
  }
});

export const BoardAssetRefSchema = z.object({
  type: z.enum(["space-file", "extension"]),
  ref: z.string().min(1).max(4096),
  digest: z.string().min(16).max(160).optional(),
});

export const BoardEffectSchema = z.object({
  id: idSchema,
  boardId: z.string().uuid(),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("item"), itemId: idSchema }).strict(),
    z.object({ type: z.literal("board") }).strict(),
  ]),
  kind: extensionIdSchema,
  kindVersion: z.number().int().positive(),
  enabled: z.boolean().default(true),
  lifecycle: z.enum(["persistent", "when-visible", "manual"]),
  timeOrigin: z.enum(["board", "visible", "activation"]),
  layer: z.enum(["behind", "front", "screen"]).default("front"),
  seed: z.string().min(1).max(160),
  params: jsonObjectSchema.default({}),
  assetRefs: z.array(BoardAssetRefSchema).default([]),
  metadata: jsonObjectSchema.default({}),
  revision: z.number().int().nonnegative(),
});

export type BoardCameraState = z.infer<typeof BoardCameraStateSchema>;
export type BoardCameraFocus = z.infer<typeof BoardCameraFocusSchema>;
export type BoardCameraFocusParams = z.infer<typeof BoardCameraFocusParamsSchema>;
export type BoardAssetRef = z.infer<typeof BoardAssetRefSchema>;
export type BoardEffect = z.infer<typeof BoardEffectSchema>;

export type BoardRecord = {
  id: string;
  spaceId: string;
  title: string;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BoardNodeRecord = {
  boardId: string;
  nodeId: string;
  type: string;
  parentId: string | null;
  orderKey: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  refKind: string | null;
  refPath: string | null;
  refUrl: string | null;
  view: Record<string, unknown>;
  style: Record<string, unknown>;
  data: Record<string, unknown>;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type BoardNodeInput = Omit<BoardNodeRecord, "boardId" | "version" | "createdAt" | "updatedAt">;

export const BoardNodeInputSchema = z.object({
  nodeId: idSchema,
  type: z.string().min(1).max(40),
  parentId: idSchema.nullable(),
  orderKey: z.string().max(4096).nullable(),
  x: finiteSchema,
  y: finiteSchema,
  width: finiteSchema.positive(),
  height: finiteSchema.positive(),
  rotation: finiteSchema,
  refKind: z.string().max(40).nullable(),
  refPath: z.string().max(4096).nullable(),
  refUrl: z.string().max(4096).nullable(),
  view: jsonObjectSchema,
  style: jsonObjectSchema,
  data: jsonObjectSchema,
});

export const BOARD_DELETE_REASONS = ["user-delete", "orphan-cleanup", "layout-replace", "placeholder-cascade", "node-cascade"] as const;
export type BoardDeleteReason = (typeof BOARD_DELETE_REASONS)[number] | (string & {});

type BoardOperationBase = {
  opId?: string;
  /** Optional local undo hint. Servers recompute authoritative inverse data. */
  inverse?: Record<string, unknown>;
};
export type BoardOperation =
  | (BoardOperationBase & { type: "board.patch"; payload: { patch: { title?: string; metadata?: Record<string, unknown>; metadataPatch?: Record<string, unknown> } } })
  | (BoardOperationBase & { type: "node.create"; payload: { node: BoardNodeInput } })
  | (BoardOperationBase & { type: "node.patch"; payload: { nodeId: string; patch: Partial<BoardNodeInput> } })
  | (BoardOperationBase & { type: "node.delete"; payload: { nodeId: string; reason?: BoardDeleteReason } })
  | (BoardOperationBase & { type: "connection.create"; payload: { connection: BoardConnectionInput } })
  | (BoardOperationBase & { type: "connection.patch"; payload: { connectionId: string; patch: BoardConnectionPatch } })
  | (BoardOperationBase & { type: "connection.delete"; payload: { connectionId: string; reason?: BoardDeleteReason } })
  | (BoardOperationBase & { type: "effect.upsert"; payload: { effect: Omit<BoardEffect, "boardId" | "revision"> } })
  | (BoardOperationBase & { type: "effect.delete"; payload: { effectId: string } })
  | (BoardOperationBase & { type: "composition.apply"; payload: { composition: Omit<BoardComposition, "revision"> } })
  | (BoardOperationBase & { type: "composition.delete"; payload: { compositionId: string } });

export type BoardTransaction = {
  txId: string;
  boardId: string;
  baseVersion: number;
  clientId?: string | null;
  undoGroupId?: string | null;
  operations: BoardOperation[];
};

export type BoardMutationReceipt = {
  mutationId: string;
  status: "applied" | "validated";
  replayed: boolean;
  board: { id: string; version: number };
  changed: {
    items: string[];
    connections: string[];
    effects: string[];
    compositions: string[];
    board: boolean;
  };
};

export type BoardSummary = {
  board: BoardRecord;
  counts: {
    nodes: number;
    connections: number;
    effects: number;
    compositions: number;
  };
  playback: BoardPlaybackSnapshot | null;
};

export type BoardBootstrap = {
  board: BoardRecord;
  nodes: BoardNodeRecord[];
  connections: BoardConnectionRecord[];
  effects: BoardEffect[];
  compositions: BoardComposition[];
  playback: BoardPlaybackSnapshot | null;
};

/** Immutable semantic Board state shared by Checkpoints and published Works. */
export type BoardSnapshot = BoardBootstrap & {
  kind: typeof BOARD_SNAPSHOT_KIND;
  version: typeof BOARD_PROTOCOL_VERSION;
  capturedAt: string;
};

export const BoardCreateInputSchema = z.object({
  path: z.string().min(1),
  /** Reused by clients when board creation is interrupted and retried. */
  mutationId: z.string().max(128).optional(),
  title: z.string().min(1).max(255).optional(),
  metadata: jsonObjectSchema.optional(),
  items: z.array(BoardAuthoringItemSchema).max(50_000).optional(),
  connections: z.array(BoardConnectionSchema).max(50_000).optional(),
  effects: z.array(BoardEffectSchema.omit({ boardId: true, revision: true })).optional(),
  compositions: z.array(BoardCompositionInputSchema).optional(),
});

export type BoardCreateInput = z.infer<typeof BoardCreateInputSchema>;

export const BoardInspectInputSchema = z.object({
  include: z.array(z.enum(["nodes", "connections", "effects", "compositions", "playback"])).optional(),
  viewport: z.object({
    x: finiteSchema,
    y: finiteSchema,
    width: finiteSchema.positive(),
    height: finiteSchema.positive(),
  }).optional(),
});

export type BoardInspectInput = z.infer<typeof BoardInspectInputSchema>;

export type BoardDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
  adaptation?: Record<string, unknown>;
  expected?: string;
  received?: unknown;
  allowedValues?: readonly string[];
  coordinateSpace?: BoardCoordinateSpace;
};

export type BoardValidationResult = {
  valid: boolean;
  diagnostics: BoardDiagnostic[];
  peakCost: BoardRenderCost;
};

export type BoardCapabilities = {
  protocolVersion: typeof BOARD_PROTOCOL_VERSION;
  capabilities: BoardCapability[];
  limits: BoardRenderCost;
  nodes: BoardNodeContract;
  animationChannels: typeof BOARD_ANIMATION_CHANNEL_CAPABILITIES;
};

/** Persisted on `boards.metadata.playback`: how a Board plays when opened. */
export const BoardPlaybackPolicySchema = z.object({
  compositionId: idSchema,
  /** Delay before the first local playback after opening the Board, in milliseconds. */
  delayMs: finiteSchema.nonnegative().default(0),
});

export type BoardPlaybackPolicy = z.infer<typeof BoardPlaybackPolicySchema>;

export function parseBoardPlaybackPolicy(metadata: Record<string, unknown>): BoardPlaybackPolicy | null {
  const parsed = BoardPlaybackPolicySchema.safeParse(metadata.playback);
  return parsed.success ? parsed.data : null;
}

export type BoardPlaybackStatus = "playing" | "paused" | "stopped";
export type BoardPlaybackSnapshot = {
  boardId: string;
  playbackId: string;
  compositionId: string;
  compositionRevision: number;
  playbackRevision: number;
  status: BoardPlaybackStatus;
  position: number;
  effectiveAt: number;
  timeScale: number;
  seed: string;
};

export const BoardPlaybackCommandSchema = z.discriminatedUnion("type", [
  z.object({
    commandId: idSchema,
    type: z.literal("play"),
    compositionId: idSchema,
    position: finiteSchema.nonnegative().optional(),
    timeScale: finiteSchema.positive().max(4).optional(),
    shared: z.boolean().optional(),
    seed: idSchema.optional(),
  }),
  z.object({ commandId: idSchema, type: z.literal("pause"), playbackId: z.string().uuid() }),
  z.object({
    commandId: idSchema,
    type: z.literal("seek"),
    playbackId: z.string().uuid(),
    position: finiteSchema.nonnegative(),
  }),
  z.object({ commandId: idSchema, type: z.literal("stop"), playbackId: z.string().uuid() }),
]);

export type BoardPlaybackCommand = z.infer<typeof BoardPlaybackCommandSchema>;

export function isBoardPath(path: string): boolean {
  return path.toLowerCase().endsWith(BOARD_EXTENSION);
}
