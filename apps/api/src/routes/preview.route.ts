import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { setCookie } from "hono/cookie";
import { authzDenied, getOptionalAuth, getPreviewSessionPrincipal, requireValidId } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import { PREVIEW_SESSION_TTL_SECONDS, verifyPreviewSessionToken } from "../preview-sessions.js";
import { resolveSpaceFileDownload, spaceFsJsonError, streamSpaceFile } from "../space-fs-backend.js";

const PREVIEW_SESSION_COOKIE = "__preview_session";
const router = new Hono();

function previewHost() {
  return process.env.PREVIEW_HOSTNAME?.trim().toLowerCase() ?? "";
}

function isPreviewHost(host: string | undefined) {
  const normalized = host?.split(":")[0]?.toLowerCase();
  return Boolean(normalized && previewHost() && normalized === previewHost());
}

function previewOnly(c: Context) {
  if (isPreviewHost(c.req.header("host"))) return null;
  return c.json({ message: "not found" }, 404);
}

function parseRange(value: string | undefined, size: number) {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return "invalid" as const;
  if (!match[1] && !match[2]) return "invalid" as const;
  const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
  const start = suffixLength === null ? Number(match[1]) : Math.max(0, size - suffixLength);
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size) return "invalid" as const;
  return { start, end };
}

function normalizeNextPath(input: string | undefined, spaceId: string) {
  if (!input?.startsWith("/s/")) return null;
  let url: URL;
  try {
    url = new URL(input, "https://preview.local");
  } catch {
    return null;
  }
  if (url.origin !== "https://preview.local") return null;
  const prefix = `/s/${spaceId}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

router.get("/__session", (c) => {
  const denied = previewOnly(c);
  if (denied) return denied;

  const token = c.req.query("token") ?? "";
  const session = verifyPreviewSessionToken(token);
  if (!session) return c.json({ message: "unauthorized" }, 401);
  const next = normalizeNextPath(c.req.query("next"), session.spaceId);
  if (!next) return c.json({ message: "invalid preview target" }, 400);

  setCookie(c, PREVIEW_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: PREVIEW_SESSION_TTL_SECONDS,
  });
  return c.redirect(next, 302);
});

router.get("/s/:spaceId/*", async (c) => {
  const denied = previewOnly(c);
  if (denied) return denied;

  const user = getOptionalAuth(c);
  const session = getPreviewSessionPrincipal(c);
  const spaceId = c.req.param("spaceId");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!session || session.spaceId !== spaceId) return authzDenied(c);
  if (!(await hasPermission(user, "file.view", { spaceId }))) return authzDenied(c);

  const rawPath = c.req.path.slice(`/s/${spaceId}/`.length);
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return c.json({ message: "invalid path" }, 400);
  }
  try {
    const download = await resolveSpaceFileDownload(spaceId, path, { visibility: "full" });
    const headers = {
      "cache-control": "no-store",
      "content-security-policy": "sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
      "x-content-type-options": "nosniff",
    };
    if (download.kind === "buffer") {
      const range = parseRange(c.req.header("range"), download.buffer.length);
      if (range === "invalid") return c.body(null, 416, { ...headers, "content-range": `bytes */${download.buffer.length}` });
      if (range) {
        return c.body(new Uint8Array(download.buffer.subarray(range.start, range.end + 1)), 206, {
          ...headers,
          "accept-ranges": "bytes",
          "content-length": String(range.end - range.start + 1),
          "content-range": `bytes ${range.start}-${range.end}/${download.buffer.length}`,
          "content-type": download.mimeType ?? "application/octet-stream",
        });
      }
      return c.body(new Uint8Array(download.buffer), 200, {
        ...headers,
        "accept-ranges": "bytes",
        "content-length": String(download.buffer.length),
        "content-type": download.mimeType ?? "application/octet-stream",
      });
    }
    const info = await streamSpaceFile(spaceId, path, { visibility: "full" });
    const range = parseRange(c.req.header("range"), info.size);
    if (range === "invalid") return c.body(null, 416, { ...headers, "content-range": `bytes */${info.size}` });
    if (range) {
      const stream = Readable.toWeb(createReadStream(info.target, { start: range.start, end: range.end })) as ReadableStream;
      return c.body(stream, 206, {
        ...headers,
        "accept-ranges": "bytes",
        "content-length": String(range.end - range.start + 1),
        "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
        "content-type": info.mimeType ?? "application/octet-stream",
      });
    }
    const stream = Readable.toWeb(createReadStream(info.target)) as ReadableStream;
    return c.body(stream, 200, {
      ...headers,
      "accept-ranges": "bytes",
      "content-length": String(info.size),
      "content-type": info.mimeType ?? "application/octet-stream",
    });
  } catch (error) {
    const { status, body } = spaceFsJsonError(error);
    return c.json(body, status as never);
  }
});

export default router;
