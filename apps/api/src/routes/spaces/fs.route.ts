import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { ensureFsCdnManifest, shouldUseFsCdnForMeta } from "../../space-fs-cdn-cache.js";
import { FS_CDN_DOWNLOAD_WAIT_TIMEOUT_MS } from "../../space-fs-cdn-constants.js";
import { getOptionalAuth, useAuth, requireValidId } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import {
  assertSafeRelativePath,
  createSpaceDirectory,
  deleteSpaceNode,
  listSpaceDirectory,
  moveSpaceNode,
  readSpaceFile,
  readSpaceFiles,
  spaceFsJsonError,
  streamSpaceFile,
  uploadSpaceFiles,
  writeSpaceFile,
} from "../../space-fs.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";
import { enqueueTask } from "../../tasks.js";
import {
  beginSpaceUploadComplete,
  buildSpaceUploadObjectKey,
  cancelSpaceUploadComplete,
  createPresignedPutUrl,
  createSpaceUploadId,
  deleteSpaceUploadManifest,
  finishSpaceUploadComplete,
  getSpaceUploadManifest,
  saveSpaceUploadManifest,
  type SpaceUploadManifestEntry,
} from "../../space-upload-storage.js";
import type { SpaceFsCreateUploadInput, SpaceFsCompleteUploadInput } from "@cohub/protocol/fs";

const router = new Hono();

const MAX_UPLOAD_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_FILES = 1000;

const assertSafeUploadPathPart = (part: string) => {
  if (
    !part ||
    part === "." ||
    part === ".." ||
    part.length > 255 ||
    part.trim() !== part ||
    /[<>:"/\\|?*]/.test(part) ||
    part.split("").some((char) => char.charCodeAt(0) <= 0x1f)
  ) {
    throw new Error("Invalid upload path.");
  }
  return part;
};

const normalizeUploadRelativePath = (input: string) => {
  const raw = assertSafeRelativePath(input, { allowEmpty: false });
  const parts = raw.split("/").map(assertSafeUploadPathPart);
  const normalized = parts.join("/");
  if (normalized.length > 4096) throw new Error("Upload path is too long.");
  return normalized;
};

router.get("/tree", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  try {
    return c.json(await listSpaceDirectory(spaceId, path));
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

router.get("/file", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  try {
    const result = await readSpaceFile(spaceId, path);
    if (!("content" in result)) return c.json(result, 202);
    return c.json(result);
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

router.post("/files", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ paths: string[] }>().catch(() => null);
  if (!Array.isArray(body?.paths)) return c.json({ message: "paths are required" }, 400);
  try {
    return c.json(await readSpaceFiles(spaceId, body.paths));
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

router.put("/file", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req
    .json<{ path: string; content: string; encoding: "utf-8" | "base64" }>()
    .catch(() => null);
  if (!body?.path || typeof body.content !== "string" || !body.encoding) {
    return c.json({ message: "path, content and encoding are required" }, 400);
  }
  try {
    const result = await writeSpaceFile(spaceId, body);
    const changes = [{ path: result.path, kind: "modify" as const, nodeType: "file" as const, size: result.size, mtimeMs: result.mtimeMs }];
    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      changes,
    }).catch(console.error);
    return c.json(result);
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

router.post("/dir", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ path: string }>().catch(() => null);
  if (!body?.path) return c.json({ message: "path is required" }, 400);
  try {
    const result = await createSpaceDirectory(spaceId, body.path);
    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      changes: [{ path: result.path, kind: "create", nodeType: "dir", mtimeMs: result.mtimeMs }],
    }).catch(console.error);
    return c.json(result);
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

router.delete("/node", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  const recursive = c.req.query("recursive") === "true";
  try {
    const result = await deleteSpaceNode(spaceId, path, recursive);
    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      changes: [{ path: result.path, kind: "delete", nodeType: result.nodeType === "symlink" ? "unknown" : result.nodeType }],
    }).catch(console.error);
    return c.json(result);
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

router.post("/move", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ fromPath: string; toPath: string }>().catch(() => null);
  if (!body?.fromPath || !body?.toPath) return c.json({ message: "fromPath and toPath are required" }, 400);
  try {
    const result = await moveSpaceNode(spaceId, body);
    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      changes: [{ path: result.toPath, oldPath: result.fromPath, kind: "rename", nodeType: "unknown" }],
    }).catch(console.error);
    return c.json(result);
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

router.get("/download", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  try {
    const info = await streamSpaceFile(spaceId, path);
    const meta = {
      spaceId,
      path: info.path,
      name: info.name,
      size: info.size,
      mimeType: info.mimeType,
      mtimeMs: info.mtimeMs,
    };
    if (shouldUseFsCdnForMeta(meta)) {
      const manifest = await ensureFsCdnManifest(meta, "download_miss", FS_CDN_DOWNLOAD_WAIT_TIMEOUT_MS);
      if (!manifest) return c.json({ message: "file is preparing", retryAfterMs: 2000 }, 202);
      return c.redirect(manifest.url, 302);
    }
    const buffer = await readFile(info.target);
    return c.body(new Uint8Array(buffer), 200, {
      "content-type": info.mimeType ?? "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(info.name)}`,
    });
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

router.post("/uploads", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<SpaceFsCreateUploadInput>().catch(() => null);
  if (!body?.entries?.length) return c.json({ message: "entries are required" }, 400);
  if (body.entries.length > MAX_UPLOAD_FILES) return c.json({ message: "too many files" }, 413);

  const uploadId = createSpaceUploadId();
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const entries: SpaceUploadManifestEntry[] = [];
  let totalBytes = 0;

  try {
    const targetDir = body.targetDir ? assertSafeRelativePath(body.targetDir, { allowEmpty: true }) : "";
    for (const entry of body.entries) {
      if (typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || seenIds.has(entry.id)) {
        return c.json({ message: "entry ids must be unique safe strings" }, 400);
      }
      seenIds.add(entry.id);
      if (typeof entry.name !== "string" || entry.name.length === 0 || entry.name.length > 255) {
        return c.json({ message: "invalid file name" }, 400);
      }
      if (typeof entry.relativePath !== "string" || entry.relativePath.length === 0 || entry.relativePath.length > 4096) {
        return c.json({ message: "invalid upload path" }, 400);
      }
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_UPLOAD_FILE_BYTES) {
        return c.json({ message: "file too large" }, 413);
      }
      if (entry.mimeType != null && (typeof entry.mimeType !== "string" || entry.mimeType.length > 255)) {
        return c.json({ message: "invalid mime type" }, 400);
      }
      totalBytes += entry.size;
      if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) return c.json({ message: "upload too large" }, 413);
      const relativePath = normalizeUploadRelativePath(entry.relativePath || entry.name);
      if (seenPaths.has(relativePath)) return c.json({ message: "duplicate upload path" }, 400);
      seenPaths.add(relativePath);
      const name = relativePath.split("/").at(-1) ?? entry.name;
      entries.push({
        id: entry.id,
        name,
        relativePath,
        size: entry.size,
        mimeType: entry.mimeType ?? null,
        objectKey: buildSpaceUploadObjectKey({ spaceId, uploadId, entryId: entry.id }),
      });
    }

    const planned = entries.map((entry) => {
      const signed = createPresignedPutUrl(entry.objectKey, entry.mimeType);
      return { id: entry.id, objectKey: entry.objectKey, uploadUrl: signed.uploadUrl, headers: signed.headers };
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await saveSpaceUploadManifest({
      uploadId,
      spaceId,
      userId: user.uuid,
      targetDir,
      entries,
      createdAt: new Date().toISOString(),
      expiresAt,
    });
    return c.json({ uploadId, expiresAt, entries: planned });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase().replace(/\.$/, "") : "failed to create upload";
    return c.json({ message }, 400);
  }
});

router.post("/uploads/:uploadId/complete", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const uploadId = c.req.param("uploadId");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!uploadId || !requireValidId(uploadId)) return c.json({ message: "upload not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<SpaceFsCompleteUploadInput>().catch(() => null);
  if (!body?.entries?.length || !Array.isArray(body.entries)) return c.json({ message: "entries are required" }, 400);
  if (body.entries.some((entry) => typeof entry.id !== "string")) return c.json({ message: "invalid entries" }, 400);
  const completeState = await beginSpaceUploadComplete(spaceId, uploadId);
  if (!completeState.acquired) {
    if (completeState.taskRunId && completeState.taskRunId !== "pending") return c.json({ ok: true, taskRunId: completeState.taskRunId });
    return c.json({ message: "upload is already being completed" }, 409);
  }

  try {
    const manifest = await getSpaceUploadManifest(spaceId, uploadId);
    if (!manifest || manifest.userId !== user.uuid) {
      await cancelSpaceUploadComplete(spaceId, uploadId);
      return c.json({ message: "upload not found" }, 404);
    }
    const completedIds = new Set(body.entries.map((entry) => entry.id));
    const entries = manifest.entries.filter((entry) => completedIds.has(entry.id));
    if (entries.length === 0) {
      await cancelSpaceUploadComplete(spaceId, uploadId);
      return c.json({ message: "no completed entries" }, 400);
    }

    const { taskRunId } = await enqueueTask({
      type: "import_space_upload",
      spaceId,
      userId: user.uuid,
      data: { ...manifest, entries },
    }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    });
    await finishSpaceUploadComplete(spaceId, uploadId, taskRunId);
    await deleteSpaceUploadManifest(spaceId, uploadId);
    return c.json({ ok: true, taskRunId });
  } catch (error) {
    await cancelSpaceUploadComplete(spaceId, uploadId);
    console.error("[space-fs] failed to complete upload", error);
    return c.json({ message: "failed to complete upload" }, 500);
  }
});

router.post("/upload", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "file.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const dir = c.req.query("dir") ?? "";
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ message: "multipart/form-data required" }, 400);

  const fileEntries = formData.getAll("files");
  const files = fileEntries.filter((e): e is File => e instanceof File);
  if (files.length === 0) return c.json({ message: "at least one file is required" }, 400);

  try {
    const result = await uploadSpaceFiles(spaceId, files, dir);
    if (result.uploaded.length > 0) {
      const changes = result.uploaded.map((file) => ({
        path: file.path,
        kind: "create" as const,
        nodeType: "file" as const,
        size: file.size,
        mtimeMs: file.mtimeMs,
      }));
      await dispatchSpaceFsChanged(spaceId, {
        source: "api-fs",
        changes,
      }).catch(console.error);
    }
    return c.json(result);
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

export default router;
