import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { useAuth, requireValidId } from "../../lib/middleware.js";
import { canWrite, canRead } from "../../permissions.js";
import {
  createSpaceDirectory,
  deleteSpaceNode,
  listSpaceDirectory,
  moveSpaceNode,
  readSpaceFile,
  spaceFsJsonError,
  streamSpaceFile,
  writeSpaceFile,
} from "../../space-fs.js";

const router = new Hono();

// GET /:id/fs/tree
router.get("/tree", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  try {
    return c.json(await listSpaceDirectory(spaceId, path));
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

// GET /:id/fs/file
router.get("/file", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  try {
    return c.json(await readSpaceFile(spaceId, path));
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

// PUT /:id/fs/file
router.put("/file", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const body = await c.req
    .json<{ path: string; content: string; encoding: "utf-8" | "base64" }>()
    .catch(() => null);
  if (!body?.path || typeof body.content !== "string" || !body.encoding) {
    return c.json({ message: "path, content and encoding are required" }, 400);
  }
  try {
    return c.json(await writeSpaceFile(spaceId, body));
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

// POST /:id/fs/dir
router.post("/dir", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ path: string }>().catch(() => null);
  if (!body?.path) return c.json({ message: "path is required" }, 400);
  try {
    return c.json(await createSpaceDirectory(spaceId, body.path));
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

// DELETE /:id/fs/node
router.delete("/node", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const path = c.req.query("path") ?? "";
  const recursive = c.req.query("recursive") === "true";
  try {
    return c.json(await deleteSpaceNode(spaceId, path, recursive));
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

// POST /:id/fs/move
router.post("/move", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ fromPath: string; toPath: string }>().catch(() => null);
  if (!body?.fromPath || !body?.toPath) return c.json({ message: "fromPath and toPath are required" }, 400);
  try {
    return c.json(await moveSpaceNode(spaceId, body));
  } catch (error) {
    const { status, body: errBody } = spaceFsJsonError(error);
    return c.json(errBody, status as never);
  }
});

// GET /:id/fs/download
router.get("/download", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canRead(user, spaceId))) return c.json({ message: "not found" }, 404);

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

export default router;
