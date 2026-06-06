import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { canvasDocuments, canvasNodes } from "@cohub/db";
import { applyCanvasTransaction, CanvasServiceError, normalizeNodes, type CanvasNodeInput, type CanvasSemanticOp } from "../../canvas-service.js";
import { db } from "../../db/index.js";
import { authzDenied, getOptionalAuth, requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { createSpaceFileExclusive, deleteSpaceNode, SpaceFsError } from "../../space-fs.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

const CANVAS_MANIFEST_KIND = "cohub.canvas.manifest";
const MAX_TITLE_LENGTH = 255;

const serializeManifest = (input: { documentId: string; title: string }) => `${JSON.stringify({
  kind: CANVAS_MANIFEST_KIND,
  version: 1,
  documentId: input.documentId,
  title: input.title,
}, null, 2)}\n`;

function canvasErrorResponse(error: unknown) {
  if (error instanceof CanvasServiceError) return { status: error.status, message: error.message };
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
  let nodes: ReturnType<typeof normalizeNodes>;
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
      if (!document) throw new CanvasServiceError(500, "Canvas operation failed");
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

router.post("/:documentId/ops", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const documentId = c.req.param("documentId");
  if (!spaceId || !documentId || !requireValidId(spaceId) || !requireValidId(documentId)) return c.json({ message: "canvas not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ txId?: string; baseVersion?: number; clientId?: string; undoGroupId?: string; ops?: CanvasSemanticOp[] }>().catch(() => null);
  if (!Array.isArray(body?.ops)) return c.json({ message: "ops are required" }, 400);
  try {
    const result = await applyCanvasTransaction({
      spaceId,
      documentId,
      actorId: user.uuid,
      txId: body.txId || crypto.randomUUID(),
      baseVersion: body.baseVersion ?? null,
      clientId: body.clientId ?? null,
      undoGroupId: body.undoGroupId ?? null,
      ops: body.ops,
    });
    return c.json(result);
  } catch (error) {
    const response = canvasErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }
});

export default router;
