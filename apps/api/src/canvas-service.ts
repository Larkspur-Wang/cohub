import { and, eq, isNull } from "drizzle-orm";
import { canvasDocuments, canvasNodes, canvasUpdates } from "@cohub/db";
import { db } from "./db/index.js";
import { dispatchCanvasTransactionApplied } from "./canvas-events.js";

export type CanvasNodeInput = {
  nodeId: string;
  type: string;
  parentId?: string | null;
  orderKey?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  refKind?: string | null;
  refPath?: string | null;
  refUrl?: string | null;
  view?: Record<string, unknown>;
  style?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export type CanvasSemanticOp = {
  opId?: string;
  type: "node.create" | "node.patch" | "node.delete";
  payload: Record<string, unknown>;
  inverse?: Record<string, unknown>;
};

export class CanvasServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_CANVAS_NODES = 2000;
export const MAX_CANVAS_OPS = 100;
export const MAX_NODE_ID_LENGTH = 120;
export const MAX_NODE_TYPE_LENGTH = 40;
export const MAX_REF_LENGTH = 4096;
export const MAX_JSON_FIELD_BYTES = 16 * 1024;
export const MAX_TRANSACTION_BYTES = 256 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
const cleanRecord = (value: unknown, fieldName: string) => {
  if (value == null) return {};
  if (!isRecord(value)) throw new CanvasServiceError(400, `${fieldName} must be an object`);
  if (jsonBytes(value) > MAX_JSON_FIELD_BYTES) throw new CanvasServiceError(413, `${fieldName} is too large`);
  return value;
};
const finiteNumber = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const optionalString = (value: unknown, fieldName: string, maxLength = MAX_REF_LENGTH) => {
  if (value == null) return null;
  if (typeof value !== "string") throw new CanvasServiceError(400, `${fieldName} must be a string`);
  if (value.length > maxLength) throw new CanvasServiceError(400, `${fieldName} is too long`);
  return value;
};

export function normalizeNode(input: CanvasNodeInput) {
  if (!input || typeof input.nodeId !== "string" || !input.nodeId.trim()) throw new CanvasServiceError(400, "nodeId is required");
  if (input.nodeId.length > MAX_NODE_ID_LENGTH) throw new CanvasServiceError(400, "nodeId is too long");
  if (typeof input.type !== "string" || !input.type.trim()) throw new CanvasServiceError(400, "node type is required");
  if (input.type.length > MAX_NODE_TYPE_LENGTH) throw new CanvasServiceError(400, "node type is too long");
  return {
    nodeId: input.nodeId.trim(),
    type: input.type.trim(),
    parentId: optionalString(input.parentId, "parentId"),
    orderKey: optionalString(input.orderKey, "orderKey"),
    x: finiteNumber(input.x, 0),
    y: finiteNumber(input.y, 0),
    width: Math.max(1, finiteNumber(input.width, 240)),
    height: Math.max(1, finiteNumber(input.height, 160)),
    rotation: finiteNumber(input.rotation, 0),
    refKind: optionalString(input.refKind, "refKind", 40),
    refPath: optionalString(input.refPath, "refPath"),
    refUrl: optionalString(input.refUrl, "refUrl"),
    view: cleanRecord(input.view, "view"),
    style: cleanRecord(input.style, "style"),
    animation: cleanRecord(input.animation, "animation"),
    data: cleanRecord(input.data, "data"),
  };
}

export function normalizeNodes(input: CanvasNodeInput[]) {
  if (input.length > MAX_CANVAS_NODES) throw new CanvasServiceError(413, "Too many canvas nodes");
  const nodes = input.map(normalizeNode);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.nodeId)) throw new CanvasServiceError(400, "nodeId must be unique");
    seen.add(node.nodeId);
  }
  return nodes;
}

type NormalizedPatch = Partial<ReturnType<typeof normalizeNode>>;

function normalizePatch(input: Record<string, unknown>): NormalizedPatch {
  const patch: NormalizedPatch = {};
  if ("type" in input) {
    if (typeof input.type !== "string" || !input.type.trim()) throw new CanvasServiceError(400, "type must be a non-empty string");
    if (input.type.length > MAX_NODE_TYPE_LENGTH) throw new CanvasServiceError(400, "type is too long");
    patch.type = input.type.trim();
  }
  if ("parentId" in input) patch.parentId = optionalString(input.parentId, "parentId");
  if ("orderKey" in input) patch.orderKey = optionalString(input.orderKey, "orderKey");
  if ("x" in input) patch.x = finiteNumber(input.x, 0);
  if ("y" in input) patch.y = finiteNumber(input.y, 0);
  if ("width" in input) patch.width = Math.max(1, finiteNumber(input.width, 240));
  if ("height" in input) patch.height = Math.max(1, finiteNumber(input.height, 160));
  if ("rotation" in input) patch.rotation = finiteNumber(input.rotation, 0);
  if ("refKind" in input) patch.refKind = optionalString(input.refKind, "refKind", 40);
  if ("refPath" in input) patch.refPath = optionalString(input.refPath, "refPath");
  if ("refUrl" in input) patch.refUrl = optionalString(input.refUrl, "refUrl");
  if ("view" in input) patch.view = cleanRecord(input.view, "view");
  if ("style" in input) patch.style = cleanRecord(input.style, "style");
  if ("animation" in input) patch.animation = cleanRecord(input.animation, "animation");
  if ("data" in input) patch.data = cleanRecord(input.data, "data");
  if (Object.keys(patch).length === 0) throw new CanvasServiceError(400, "node.patch is empty");
  return patch;
}

function normalizeOp(op: CanvasSemanticOp): CanvasSemanticOp {
  if (!op || typeof op.type !== "string" || !isRecord(op.payload)) throw new CanvasServiceError(400, "invalid op");
  if (op.type === "node.create") {
    const node = normalizeNode(op.payload.node as CanvasNodeInput);
    return { opId: optionalString(op.opId, "opId", 120) ?? undefined, type: "node.create", payload: { node }, inverse: isRecord(op.inverse) ? op.inverse : undefined };
  }
  if (op.type === "node.patch") {
    const nodeId = optionalString(op.payload.nodeId, "nodeId", MAX_NODE_ID_LENGTH);
    if (!nodeId) throw new CanvasServiceError(400, "node.patch requires nodeId");
    const patch = isRecord(op.payload.patch) ? normalizePatch(op.payload.patch) : null;
    if (!patch) throw new CanvasServiceError(400, "node.patch requires patch");
    return { opId: optionalString(op.opId, "opId", 120) ?? undefined, type: "node.patch", payload: { nodeId, patch }, inverse: isRecord(op.inverse) ? op.inverse : undefined };
  }
  if (op.type === "node.delete") {
    const nodeId = optionalString(op.payload.nodeId, "nodeId", MAX_NODE_ID_LENGTH);
    if (!nodeId) throw new CanvasServiceError(400, "node.delete requires nodeId");
    return { opId: optionalString(op.opId, "opId", 120) ?? undefined, type: "node.delete", payload: { nodeId }, inverse: isRecord(op.inverse) ? op.inverse : undefined };
  }
  throw new CanvasServiceError(400, "unsupported op type");
}

export function normalizeCanvasOps(ops: CanvasSemanticOp[]) {
  if (!ops.length) throw new CanvasServiceError(400, "ops are required");
  if (ops.length > MAX_CANVAS_OPS) throw new CanvasServiceError(413, "too many ops");
  if (jsonBytes(ops) > MAX_TRANSACTION_BYTES) throw new CanvasServiceError(413, "transaction is too large");
  const normalized = ops.map(normalizeOp);
  if (jsonBytes(normalized) > MAX_TRANSACTION_BYTES) throw new CanvasServiceError(413, "transaction is too large");
  return normalized;
}

export async function applyCanvasTransaction(input: {
  spaceId: string;
  documentId: string;
  actorId: string;
  txId: string;
  baseVersion?: number | null;
  clientId?: string | null;
  undoGroupId?: string | null;
  ops: CanvasSemanticOp[];
  broadcast?: boolean;
}) {
  const normalizedOps = normalizeCanvasOps(input.ops);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(canvasDocuments)
      .where(and(eq(canvasDocuments.id, input.documentId), eq(canvasDocuments.spaceId, input.spaceId), isNull(canvasDocuments.deletedAt)))
      .for("update")
      .limit(1);
    if (!document) throw new CanvasServiceError(404, "canvas not found");

    // Idempotency via the partial unique index on (document_id, tx_id). Checked
    // before the version guard so a retried tx (stale baseVersion) still resolves
    // as success rather than a spurious 409. After migration, tx_id is always set
    // for new rows and the index is used directly — no JSON fallback.
    const [existing] = await tx
      .select({ version: canvasUpdates.version })
      .from(canvasUpdates)
      .where(and(eq(canvasUpdates.documentId, input.documentId), eq(canvasUpdates.txId, input.txId)))
      .limit(1);
    if (existing) {
      const nodes = await tx.select().from(canvasNodes).where(and(eq(canvasNodes.documentId, input.documentId), isNull(canvasNodes.deletedAt))).orderBy(canvasNodes.orderKey);
      return { document, nodes, version: document.version, ops: normalizedOps, idempotent: true };
    }

    if (input.baseVersion != null && input.baseVersion !== document.version) {
      throw new CanvasServiceError(409, "canvas version conflict");
    }
    const nextVersion = document.version + 1;

    for (const op of normalizedOps) {
      if (op.type === "node.create") {
        const node = (op.payload as { node: ReturnType<typeof normalizeNode> }).node;
        await tx.insert(canvasNodes).values({
          documentId: input.documentId,
          nodeId: node.nodeId,
          type: node.type,
          parentId: node.parentId,
          orderKey: node.orderKey,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
          refKind: node.refKind,
          refPath: node.refPath,
          refUrl: node.refUrl,
          view: node.view,
          style: node.style,
          animation: node.animation,
          data: node.data,
          version: nextVersion,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        }).onConflictDoUpdate({
          target: [canvasNodes.documentId, canvasNodes.nodeId],
          set: {
            type: node.type,
            parentId: node.parentId,
            orderKey: node.orderKey,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            rotation: node.rotation,
            refKind: node.refKind,
            refPath: node.refPath,
            refUrl: node.refUrl,
            view: node.view,
            style: node.style,
            animation: node.animation,
            data: node.data,
            version: nextVersion,
            updatedAt: now,
            deletedAt: null,
          },
        });
        continue;
      }
      if (op.type === "node.patch") {
        const { nodeId, patch } = op.payload as { nodeId: string; patch: NormalizedPatch };
        const updated = await tx.update(canvasNodes)
          .set({ ...patch, updatedAt: now, version: nextVersion })
          .where(and(eq(canvasNodes.documentId, input.documentId), eq(canvasNodes.nodeId, nodeId), isNull(canvasNodes.deletedAt)))
          .returning({ nodeId: canvasNodes.nodeId });
        if (updated.length === 0) throw new CanvasServiceError(404, "canvas node not found");
        continue;
      }
      const nodeId = (op.payload as { nodeId: string }).nodeId;
      const deleted = await tx.update(canvasNodes)
        .set({ deletedAt: now, updatedAt: now, version: nextVersion })
        .where(and(eq(canvasNodes.documentId, input.documentId), eq(canvasNodes.nodeId, nodeId), isNull(canvasNodes.deletedAt)))
        .returning({ nodeId: canvasNodes.nodeId });
      if (deleted.length === 0) throw new CanvasServiceError(404, "canvas node not found");
    }

    // Document row is locked FOR UPDATE above, so same-document requests are
    // serialised; the pre-insert txId lookup is sufficient for idempotency.
    // Do not catch unique violations here — after 23505 the transaction is
    // aborted and further SELECTs would fail with 25P02.
    await tx.insert(canvasUpdates).values({
      documentId: input.documentId,
      version: nextVersion,
      actorId: input.actorId,
      clientId: input.clientId ?? null,
      txId: input.txId,
      type: "canvas.tx",
      payload: { txId: input.txId, baseVersion: input.baseVersion ?? null, ops: normalizedOps },
      undoGroupId: input.undoGroupId ?? null,
      createdAt: now,
    });
    const [updated] = await tx.update(canvasDocuments).set({ version: nextVersion, updatedAt: now }).where(eq(canvasDocuments.id, input.documentId)).returning();
    const nodes = await tx.select().from(canvasNodes).where(and(eq(canvasNodes.documentId, input.documentId), isNull(canvasNodes.deletedAt))).orderBy(canvasNodes.orderKey);
    return { document: updated ?? { ...document, version: nextVersion, updatedAt: now }, nodes, version: nextVersion, ops: normalizedOps, idempotent: false };
  });

  // Only broadcast when a new version was actually written; an idempotent replay
  // must not re-emit an event for a change that was already announced.
  if (input.broadcast !== false && !result.idempotent) {
    await dispatchCanvasTransactionApplied({
      spaceId: input.spaceId,
      documentId: input.documentId,
      actorId: input.actorId,
      txId: input.txId,
      version: result.version,
      ops: result.ops as Array<Record<string, unknown>>,
    }).catch(() => undefined);
  }
  return { document: result.document, nodes: result.nodes, version: result.version };
}
