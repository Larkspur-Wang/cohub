import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { canvasCheckpointSnapshots, canvasDocuments, canvasNodes } from "@cohub/db";
import { db } from "../db.js";

const CANVAS_MANIFEST_KIND = "cohub.canvas.manifest";

function assertSafeRelativePath(path: string) {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`unsafe canvas path: ${path}`);
  }
  return normalized;
}

function safeJoin(root: string, path: string) {
  const safePath = assertSafeRelativePath(path);
  const target = resolve(root, safePath);
  const rel = relative(resolve(root), target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${path}`);
  return target;
}

function manifestContent(input: { documentId: string; title: string }) {
  return `${JSON.stringify({ kind: CANVAS_MANIFEST_KIND, version: 1, documentId: input.documentId, title: input.title }, null, 2)}\n`;
}

export async function saveCanvasCheckpointSnapshots(input: { checkpointId: string; spaceId: string }) {
  const documents = await db.select().from(canvasDocuments).where(eq(canvasDocuments.spaceId, input.spaceId));
  const activeDocuments = documents.filter((document) => !document.deletedAt);
  const snapshots = [];
  for (const document of activeDocuments) {
    const nodes = await db.select().from(canvasNodes).where(eq(canvasNodes.documentId, document.id));
    const activeNodes = nodes.filter((node) => !node.deletedAt);
    const manifest = {
      kind: "cohub.canvas.checkpoint",
      version: 1,
      document: {
        id: document.id,
        filePath: document.filePath,
        title: document.title,
        version: document.version,
        meta: document.meta ?? null,
      },
      nodes: activeNodes,
    };
    const [snapshot] = await db.insert(canvasCheckpointSnapshots).values({
      checkpointId: input.checkpointId,
      sourceDocumentId: document.id,
      sourceSpaceId: input.spaceId,
      sourceFilePath: document.filePath,
      sourceVersion: document.version,
      manifest,
    }).returning();
    if (snapshot) snapshots.push(snapshot);
  }
  return { count: snapshots.length };
}

export async function restoreCanvasCheckpointSnapshots(input: { checkpointId: string; targetSpaceId: string; workspaceDir: string }) {
  const snapshots = await db.select().from(canvasCheckpointSnapshots).where(eq(canvasCheckpointSnapshots.checkpointId, input.checkpointId));
  const restored = [];
  for (const snapshot of snapshots) {
    const manifest = snapshot.manifest as {
      document?: {
        filePath?: string;
        title?: string;
        meta?: Record<string, unknown> | null;
      };
      nodes?: Array<Record<string, unknown>>;
    };
    const filePath = manifest.document?.filePath ?? snapshot.sourceFilePath;
    const title = manifest.document?.title ?? filePath.split("/").at(-1) ?? "Canvas";
    const target = safeJoin(input.workspaceDir, filePath);
    const now = new Date();
    const documentId = crypto.randomUUID();
    let insertedDocument = false;
    try {
      const [document] = await db.insert(canvasDocuments).values({
        id: documentId,
        spaceId: input.targetSpaceId,
        filePath,
        title,
        version: 1,
        createdAt: now,
        updatedAt: now,
        meta: {
          ...(manifest.document?.meta ?? {}),
          restoredFrom: {
            checkpointId: input.checkpointId,
            sourceDocumentId: snapshot.sourceDocumentId,
            sourceVersion: snapshot.sourceVersion,
          },
        },
      }).returning();
      if (!document) throw new Error("failed to restore canvas document");
      insertedDocument = true;

      const nodes = manifest.nodes ?? [];
      if (nodes.length) {
        await db.insert(canvasNodes).values(nodes.map((node, index) => ({
          documentId: document.id,
          nodeId: String(node.nodeId),
          type: String(node.type ?? "file"),
          parentId: typeof node.parentId === "string" ? node.parentId : null,
          orderKey: typeof node.orderKey === "string" ? node.orderKey : String(index).padStart(8, "0"),
          x: typeof node.x === "number" ? node.x : 0,
          y: typeof node.y === "number" ? node.y : 0,
          width: typeof node.width === "number" ? node.width : 240,
          height: typeof node.height === "number" ? node.height : 160,
          rotation: typeof node.rotation === "number" ? node.rotation : 0,
          refKind: typeof node.refKind === "string" ? node.refKind : null,
          refPath: typeof node.refPath === "string" ? node.refPath : null,
          refUrl: typeof node.refUrl === "string" ? node.refUrl : null,
          view: node.view && typeof node.view === "object" && !Array.isArray(node.view) ? node.view as Record<string, unknown> : {},
          style: node.style && typeof node.style === "object" && !Array.isArray(node.style) ? node.style as Record<string, unknown> : {},
          animation: node.animation && typeof node.animation === "object" && !Array.isArray(node.animation) ? node.animation as Record<string, unknown> : {},
          data: node.data && typeof node.data === "object" && !Array.isArray(node.data) ? node.data as Record<string, unknown> : {},
          version: 1,
          createdAt: now,
          updatedAt: now,
        })));
      }

      await mkdir(dirname(target), { recursive: true, mode: 0o775 });
      await writeFile(target, manifestContent({ documentId: document.id, title }));
      restored.push({ path: filePath, documentId: document.id });
    } catch (error) {
      if (insertedDocument) await db.update(canvasDocuments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(canvasDocuments.id, documentId)).catch(() => undefined);
      throw error;
    }
  }
  return { count: restored.length, restored };
}
