import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { boardDocuments, boardNodes } from "@cohub/db";
import { BOARD_EXTENSION, BOARD_MANIFEST_KIND, isBoardPath } from "@cohub/protocol";
import { applyBoardTransaction, BoardServiceError, normalizeNodes, type BoardSemanticOp } from "../../board-service.js";
import { db } from "../../db/index.js";
import { authzDenied, getOptionalAuth, requireValidId, useAuth } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { assertSafeRelativePath, createSpaceFileExclusive, deleteSpaceNode, SpaceFsError } from "../../space-fs-backend.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

const MAX_TITLE_LENGTH = 255;

const serializeManifest = (input: { documentId: string; title: string }) => `${JSON.stringify({
  kind: BOARD_MANIFEST_KIND,
  version: 1,
  documentId: input.documentId,
  title: input.title,
}, null, 2)}\n`;

function boardErrorResponse(error: unknown) {
  if (error instanceof BoardServiceError) return { status: error.status, message: error.message };
  if (error instanceof SpaceFsError) return { status: error.status, message: error.message };
  return { status: 500, message: "Board operation failed" };
}

async function loadDocumentForSpace(spaceId: string, documentId: string) {
  const [document] = await db
    .select()
    .from(boardDocuments)
    .where(and(eq(boardDocuments.id, documentId), eq(boardDocuments.spaceId, spaceId), isNull(boardDocuments.deletedAt)))
    .limit(1);
  return document ?? null;
}

router.post("/", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ message: "invalid request body" }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.path !== "string" || !input.path.trim()) return c.json({ message: "path is required" }, 400);
  if (input.title !== undefined && typeof input.title !== "string") return c.json({ message: "title must be a string" }, 400);
  if (input.nodes !== undefined && !Array.isArray(input.nodes)) return c.json({ message: "nodes must be an array" }, 400);
  let path: string;
  try {
    path = assertSafeRelativePath(input.path);
  } catch (error) {
    const response = boardErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }
  if (!isBoardPath(path)) return c.json({ message: `path must end with ${BOARD_EXTENSION}` }, 400);
  const title = ((input.title as string | undefined)?.trim() || path.split("/").at(-1) || "Board").slice(0, MAX_TITLE_LENGTH);
  const now = new Date();
  let nodes: ReturnType<typeof normalizeNodes>;
  try {
    nodes = normalizeNodes(input.nodes ?? []);
  } catch (error) {
    const response = boardErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }

  let written: Awaited<ReturnType<typeof createSpaceFileExclusive>> | null = null;
  try {
    const manifestId = crypto.randomUUID();
    const createdFile = await createSpaceFileExclusive(spaceId, { path, content: serializeManifest({ documentId: manifestId, title }), encoding: "utf-8" });
    written = createdFile;
    const result = await db.transaction(async (tx) => {
      const [document] = await tx.insert(boardDocuments).values({
        id: manifestId,
        spaceId,
        filePath: createdFile.path,
        title,
        version: 0,
        createdAt: now,
        updatedAt: now,
      }).returning();
      if (!document) throw new BoardServiceError(500, "Board operation failed");
      if (nodes.length) {
        await tx.insert(boardNodes).values(nodes.map((node, index) => ({
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
    const response = boardErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }
});

router.get("/by-path", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);
  const rawPath = c.req.query("path");
  if (!rawPath?.trim()) return c.json({ message: "path is required" }, 400);
  let path: string;
  try {
    path = assertSafeRelativePath(rawPath);
  } catch (error) {
    const response = boardErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }

  const [document] = await db
    .select()
    .from(boardDocuments)
    .where(and(eq(boardDocuments.spaceId, spaceId), eq(boardDocuments.filePath, path), isNull(boardDocuments.deletedAt)))
    .limit(1);
  if (!document) return c.json({ message: "board not found" }, 404);
  return c.json({ document });
});

router.get("/:documentId/bootstrap", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const documentId = c.req.param("documentId");
  if (!spaceId || !documentId || !requireValidId(spaceId) || !requireValidId(documentId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);

  const document = await loadDocumentForSpace(spaceId, documentId);
  if (!document) return c.json({ message: "board not found" }, 404);
  const nodes = await db
    .select()
    .from(boardNodes)
    .where(and(eq(boardNodes.documentId, documentId), isNull(boardNodes.deletedAt)))
    .orderBy(boardNodes.orderKey);
  return c.json({ document, nodes });
});

router.post("/:documentId/ops", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const spaceId = c.req.param("id");
  const documentId = c.req.param("documentId");
  if (!spaceId || !documentId || !requireValidId(spaceId) || !requireValidId(documentId)) return c.json({ message: "board not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return authzDenied(c);

  const body = await c.req.json<{ txId?: string; baseVersion?: number; clientId?: string; undoGroupId?: string; ops?: BoardSemanticOp[] }>().catch(() => null);
  if (!Array.isArray(body?.ops)) return c.json({ message: "ops are required" }, 400);
  try {
    const result = await applyBoardTransaction({
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
    const response = boardErrorResponse(error);
    return c.json({ message: response.message }, response.status as never);
  }
});

export default router;
