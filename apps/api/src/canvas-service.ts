import { and, eq, isNull } from "drizzle-orm";
import { canvasDocuments, canvasNodes, canvasUpdates } from "@cohub/db";
import { db } from "./db/index.js";
import { dispatchCanvasTransactionApplied } from "./canvas-events.js";
import {
  CanvasServiceError,
  normalizeCanvasOps,
  type normalizeNode,
  type CanvasSemanticOp,
  type NormalizedPatch,
} from "./canvas-ops.js";

export * from "./canvas-ops.js";

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
      .select({ version: canvasUpdates.version, payload: canvasUpdates.payload })
      .from(canvasUpdates)
      .where(and(eq(canvasUpdates.documentId, input.documentId), eq(canvasUpdates.txId, input.txId)))
      .limit(1);
    if (existing) {
      const nodes = await tx.select().from(canvasNodes).where(and(eq(canvasNodes.documentId, input.documentId), isNull(canvasNodes.deletedAt))).orderBy(canvasNodes.orderKey);
      const existingOps = Array.isArray(existing.payload.ops) ? existing.payload.ops as CanvasSemanticOp[] : normalizedOps;
      return { document, nodes, version: document.version, ops: existingOps, idempotent: true };
    }

    if (input.baseVersion != null && input.baseVersion !== document.version) {
      throw new CanvasServiceError(409, "canvas version conflict");
    }
    const nextVersion = document.version + 1;
    const effectiveOps: CanvasSemanticOp[] = [];
    let documentMeta = document.meta;

    for (const op of normalizedOps) {
      if (op.type === "document.patch") {
        const meta = (op.payload as { patch: { meta: Record<string, unknown> | null } }).patch.meta;
        effectiveOps.push({ ...op, inverse: { meta: documentMeta ?? null } });
        documentMeta = meta;
        continue;
      }
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
        effectiveOps.push(op);
        continue;
      }
      if (op.type === "node.patch") {
        const { nodeId, patch } = op.payload as { nodeId: string; patch: NormalizedPatch };
        const updated = await tx.update(canvasNodes)
          .set({ ...patch, updatedAt: now, version: nextVersion })
          .where(and(eq(canvasNodes.documentId, input.documentId), eq(canvasNodes.nodeId, nodeId), isNull(canvasNodes.deletedAt)))
          .returning({ nodeId: canvasNodes.nodeId });
        if (updated.length === 0) throw new CanvasServiceError(404, "canvas node not found");
        effectiveOps.push(op);
        continue;
      }
      const nodeId = (op.payload as { nodeId: string }).nodeId;
      const [deleted] = await tx.update(canvasNodes)
        .set({ deletedAt: now, updatedAt: now, version: nextVersion })
        .where(and(eq(canvasNodes.documentId, input.documentId), eq(canvasNodes.nodeId, nodeId), isNull(canvasNodes.deletedAt)))
        .returning();
      if (!deleted) throw new CanvasServiceError(404, "canvas node not found");
      const { documentId: _documentId, version: _version, createdAt: _createdAt, updatedAt: _updatedAt, deletedAt: _deletedAt, ...node } = deleted;
      effectiveOps.push({ ...op, inverse: { node } });
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
      payload: { txId: input.txId, baseVersion: input.baseVersion ?? null, ops: effectiveOps },
      undoGroupId: input.undoGroupId ?? null,
      createdAt: now,
    });
    const [updated] = await tx.update(canvasDocuments).set({ version: nextVersion, meta: documentMeta, updatedAt: now }).where(eq(canvasDocuments.id, input.documentId)).returning();
    const nodes = await tx.select().from(canvasNodes).where(and(eq(canvasNodes.documentId, input.documentId), isNull(canvasNodes.deletedAt))).orderBy(canvasNodes.orderKey);
    return { document: updated ?? { ...document, version: nextVersion, meta: documentMeta, updatedAt: now }, nodes, version: nextVersion, ops: effectiveOps, idempotent: false };
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
