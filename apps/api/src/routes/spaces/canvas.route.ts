import { and, eq, isNull, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { canvasDocuments, canvasNodes, canvasUpdates } from "@cohub/db";
import { db } from "../../db/index.js";
import { authzDenied, requireValidId, useAuth, getOptionalAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { createSpaceFileExclusive, deleteSpaceNode, SpaceFsError } from "../../space-fs.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

const CANVAS_MANIFEST_KIND = "cohub.canvas.manifest";
const MAX_CANVAS_NODES = 2000;
const MAX_NODE_ID_LENGTH = 120;
const MAX_NODE_TYPE_LENGTH = 40;
const MAX_REF_LENGTH = 4096;
const MAX_JSON_FIELD_BYTES = 16 * 1024;
const MAX_TITLE_LENGTH = 255;

class CanvasRouteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type CanvasNodeInput = {
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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
const cleanRecord = (value: unknown, fieldName: string) => {
  if (value == null) return {};
  if (!isRecord(value)) throw new CanvasRouteError(400, `${fieldName} must be an object`);
  if (jsonBytes(value) > MAX_JSON_FIELD_BYTES) throw new CanvasRouteError(413, `${fieldName} is too large`);
  return value;
};
const finiteNumber = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function normalizeNode(input: CanvasNodeInput) {
  if (!input || typeof input.nodeId !== "string" || !input.nodeId.trim()) throw new CanvasRouteError(400, "nodeId is required");
  if (input.nodeId.length > MAX_NODE_ID_LENGTH) throw new CanvasRouteError(400, "nodeId is too long");
  if (typeof input.type !== "string" || !input.type.trim()) throw new CanvasRouteError(400, "node type is required");
  if (input.type.length > MAX_NODE_TYPE_LENGTH) throw new CanvasRouteError(400, "node type is too long");
  for (const [field, value] of [["refPath", input.refPath], ["refUrl", input.refUrl], ["refKind", input.refKind], ["parentId", input.parentId], ["orderKey", input.orderKey]] as const) {
    if (typeof value === "string" && value.length > MAX_REF_LENGTH) throw new CanvasRouteError(400, `${field} is too long`);
  }
  return {
    nodeId: input.nodeId.trim(),
    type: input.type.trim().slice(0, 40),
    parentId: input.parentId ?? null,
    orderKey: input.orderKey ?? null,
    x: finiteNumber(input.x, 0),
    y: finiteNumber(input.y, 0),
    width: Math.max(1, finiteNumber(input.width, 240)),
    height: Math.max(1, finiteNumber(input.height, 160)),
    rotation: finiteNumber(input.rotation, 0),
    refKind: input.refKind ?? null,
    refPath: input.refPath ?? null,
    refUrl: input.refUrl ?? null,
    view: cleanRecord(input.view, "view"),
    style: cleanRecord(input.style, "style"),
    animation: cleanRecord(input.animation, "animation"),
    data: cleanRecord(input.data, "data"),
  };
}

const serializeManifest = (input: { documentId: string; title: string }) => `${JSON.stringify({
  kind: CANVAS_MANIFEST_KIND,
  version: 1,
  documentId: input.documentId,
  title: input.title,
}, null, 2)}\n`;

function normalizeNodes(input: CanvasNodeInput[]) {
  if (input.length > MAX_CANVAS_NODES) throw new CanvasRouteError(413, "Too many canvas nodes");
  const nodes = input.map(normalizeNode);
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.nodeId)) throw new CanvasRouteError(400, "nodeId must be unique");
    seen.add(node.nodeId);
  }
  return nodes;
}

function canvasErrorResponse(error: unknown) {
  if (error instanceof CanvasRouteError) return { status: error.status, message: error.message };
  if (error instanceof SpaceFsError) return { status: error.status, message: error.message };
  return { status: 500, message: "Canvas operation failed" };
}

async function loadDocumentForSpace(spaceId: string, documentId: string) {
  const [document] = await db
    .select()
    .from(canvasDocuments)
    .where(and(eq(canvasDocuments.id, documentId), eq(canvasDocuments.spaceId, spaceId), isNull(canvasDocuments.deletedAt)))
    .limit(1);
  return document ?? null;
}

router.post("/", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ path?: string; title?: string; nodes?: CanvasNodeInput[] }>().catch(() => null);
  const path = body?.path?.trim();
  if (!path) return c.json({ message: "path is required" }, 400);
  const title = (body?.title?.trim() || path.split("/").at(-1) || "Canvas").slice(0, MAX_TITLE_LENGTH);
  const now = new Date();
  let nodes: ReturnType<typeof normalizeNode>[];
  try {
    nodes = normalizeNodes(body?.nodes ?? []);
  } catch (error) {
    const response = canvasErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }

  let written: Awaited<ReturnType<typeof createSpaceFileExclusive>> | null = null;
  try {
    const manifestId = crypto.randomUUID();
    written = await createSpaceFileExclusive(spaceId, { path, content: serializeManifest({ documentId: manifestId, title }), encoding: "utf-8" });
    const result = await db.transaction(async (tx) => {
      const [document] = await tx.insert(canvasDocuments).values({
        id: manifestId,
        spaceId,
        filePath: path,
        title,
        version: 0,
        createdAt: now,
        updatedAt: now,
      }).returning();
      if (!document) throw new CanvasRouteError(500, "Canvas operation failed");
      if (nodes.length) {
        await tx.insert(canvasNodes).values(nodes.map((node, index) => ({
          documentId: document.id,
          nodeId: node.nodeId,
          type: node.type,
          parentId: node.parentId,
          orderKey: node.orderKey ?? String(index).padStart(8, "0"),
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
          version: 0,
          createdAt: now,
          updatedAt: now,
        })));
      }
      return document;
    });

    await dispatchSpaceFsChanged(spaceId, { source: "api-fs", changes: [{ path: written.path, kind: "create", nodeType: "file", size: written.size, mtimeMs: written.mtimeMs }] }).catch(() => undefined);
    return c.json({ document: result, nodes });
  } catch (error) {
    if (written) await deleteSpaceNode(spaceId, written.path).catch(() => undefined);
    const response = canvasErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }
});

router.get("/by-path", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);
  const path = c.req.query("path")?.trim();
  if (!path) return c.json({ message: "path is required" }, 400);

  const [document] = await db
    .select()
    .from(canvasDocuments)
    .where(and(eq(canvasDocuments.spaceId, spaceId), eq(canvasDocuments.filePath, path), isNull(canvasDocuments.deletedAt)))
    .limit(1);
  if (!document) return c.json({ message: "canvas not found" }, 404);
  return c.json({ document });
});

router.get("/:documentId/bootstrap", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const documentId = c.req.param("documentId");
  if (!spaceId || !documentId || !requireValidId(spaceId) || !requireValidId(documentId)) return c.json({ message: "canvas not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);

  const document = await loadDocumentForSpace(spaceId, documentId);
  if (!document) return c.json({ message: "canvas not found" }, 404);
  const nodes = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.documentId, documentId), isNull(canvasNodes.deletedAt)))
    .orderBy(canvasNodes.orderKey);
  return c.json({ document, nodes });
});

router.put("/:documentId/nodes", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const documentId = c.req.param("documentId");
  if (!spaceId || !documentId || !requireValidId(spaceId) || !requireValidId(documentId)) return c.json({ message: "canvas not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ nodes?: CanvasNodeInput[]; clientId?: string; undoGroupId?: string }>().catch(() => null);
  if (!Array.isArray(body?.nodes)) return c.json({ message: "nodes are required" }, 400);
  let nodes: ReturnType<typeof normalizeNode>[];
  try {
    nodes = normalizeNodes(body.nodes);
  } catch (error) {
    const response = canvasErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }

  const now = new Date();
  try {
    const result = await db.transaction(async (tx) => {
      const [document] = await tx
        .select()
        .from(canvasDocuments)
        .where(and(eq(canvasDocuments.id, documentId), eq(canvasDocuments.spaceId, spaceId), isNull(canvasDocuments.deletedAt)))
        .for("update")
        .limit(1);
      if (!document) throw new CanvasRouteError(404, "canvas not found");
      const nextVersion = document.version + 1;
      const nodeIds = nodes.map((node) => node.nodeId);
      if (nodeIds.length) {
        await tx.update(canvasNodes)
          .set({ deletedAt: now, updatedAt: now, version: nextVersion })
          .where(and(eq(canvasNodes.documentId, documentId), isNull(canvasNodes.deletedAt), notInArray(canvasNodes.nodeId, nodeIds)));
      } else {
        await tx.update(canvasNodes)
          .set({ deletedAt: now, updatedAt: now, version: nextVersion })
          .where(and(eq(canvasNodes.documentId, documentId), isNull(canvasNodes.deletedAt)));
      }
      for (const [index, node] of nodes.entries()) {
        await tx.insert(canvasNodes).values({
          documentId,
          nodeId: node.nodeId,
          type: node.type,
          parentId: node.parentId,
          orderKey: node.orderKey ?? String(index).padStart(8, "0"),
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
        }).onConflictDoUpdate({
          target: [canvasNodes.documentId, canvasNodes.nodeId],
          set: {
            type: node.type,
            parentId: node.parentId,
            orderKey: node.orderKey ?? String(index).padStart(8, "0"),
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
      }
      await tx.insert(canvasUpdates).values({
        documentId,
        version: nextVersion,
        actorId: user.uuid,
        clientId: body.clientId ?? null,
        type: "document.replace_nodes",
        payload: { nodeCount: nodes.length },
        undoGroupId: body.undoGroupId ?? null,
        createdAt: now,
      });
      const [updated] = await tx.update(canvasDocuments).set({ version: nextVersion, updatedAt: now }).where(eq(canvasDocuments.id, documentId)).returning();
      return updated ?? { ...document, version: nextVersion, updatedAt: now };
    });
    return c.json({ document: result, nodes });
  } catch (error) {
    const response = canvasErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }
});

export default router;
