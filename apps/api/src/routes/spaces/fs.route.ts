import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { getOptionalAuth, useAuth, requireValidId } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import {
  createSpaceDirectory,
  deleteSpaceNode,
  listSpaceDirectory,
  moveSpaceNode,
  readSpaceFile,
  spaceFsJsonError,
  streamSpaceFile,
  uploadSpaceFiles,
  writeSpaceFile,
} from "../../space-fs.js";
import { dispatchSpaceFsChanged } from "../../space-events.js";

const router = new Hono();

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
    return c.json(await readSpaceFile(spaceId, path));
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
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
    await dispatchSpaceFsChanged(spaceId, {
      source: "api-fs",
      changes: [{ path: result.path, kind: "modify", nodeType: "file", size: result.size, mtimeMs: result.mtimeMs }],
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
      await dispatchSpaceFsChanged(spaceId, {
        source: "api-fs",
        changes: result.uploaded.map((file) => ({
          path: file.path,
          kind: "create" as const,
          nodeType: "file" as const,
          size: file.size,
          mtimeMs: file.mtimeMs,
        })),
      }).catch(console.error);
    }
    return c.json(result);
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

export default router;
