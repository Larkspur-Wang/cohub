import * as direct from "./space-fs.js";
import * as remote from "./space-fs-remote.js";
import { getSpaceSandboxBySpaceId } from "./space-sandboxes.js";

// Provider-aware facade over the space filesystem. Cloud spaces read/write the
// shared PVC directly (the existing implementation); local spaces are served
// over the sandbox RPC relay against the user's machine. Routes depend on this
// module so they stay provider-agnostic.

const PROVIDER_CACHE_TTL_MS = 30_000;
const providerCache = new Map<string, { provider: "cloud" | "local"; expiresAt: number }>();

async function isLocal(spaceId: string): Promise<boolean> {
  const now = Date.now();
  const cached = providerCache.get(spaceId);
  if (cached && cached.expiresAt > now) return cached.provider === "local";
  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  const provider = sandbox?.provider === "local" ? "local" : "cloud";
  providerCache.set(spaceId, { provider, expiresAt: now + PROVIDER_CACHE_TTL_MS });
  return provider === "local";
}

type Visibility = Parameters<typeof direct.listSpaceDirectory>[2];

export async function listSpaceDirectory(spaceId: string, path?: string, options?: Visibility) {
  return (await isLocal(spaceId))
    ? remote.listSpaceDirectory(spaceId, path, options)
    : direct.listSpaceDirectory(spaceId, path, options);
}

export async function readSpaceFile(spaceId: string, path: string, options?: Visibility) {
  return (await isLocal(spaceId))
    ? remote.readSpaceFile(spaceId, path, options)
    : direct.readSpaceFile(spaceId, path, options);
}

export async function readSpaceFiles(spaceId: string, paths: string[], options?: Visibility) {
  return (await isLocal(spaceId))
    ? remote.readSpaceFiles(spaceId, paths, options)
    : direct.readSpaceFiles(spaceId, paths, options);
}

export async function writeSpaceFile(spaceId: string, input: Parameters<typeof direct.writeSpaceFile>[1]) {
  return (await isLocal(spaceId))
    ? remote.writeSpaceFile(spaceId, input)
    : direct.writeSpaceFile(spaceId, input);
}

export async function createSpaceFileExclusive(spaceId: string, input: Parameters<typeof direct.createSpaceFileExclusive>[1]) {
  return (await isLocal(spaceId))
    ? remote.createSpaceFileExclusive(spaceId, input)
    : direct.createSpaceFileExclusive(spaceId, input);
}

export async function createSpaceDirectory(spaceId: string, path: string) {
  return (await isLocal(spaceId))
    ? remote.createSpaceDirectory(spaceId, path)
    : direct.createSpaceDirectory(spaceId, path);
}

export async function deleteSpaceNode(spaceId: string, path: string, recursive = false) {
  return (await isLocal(spaceId))
    ? remote.deleteSpaceNode(spaceId, path, recursive)
    : direct.deleteSpaceNode(spaceId, path, recursive);
}

export async function moveSpaceNode(spaceId: string, input: Parameters<typeof direct.moveSpaceNode>[1]) {
  return (await isLocal(spaceId))
    ? remote.moveSpaceNode(spaceId, input)
    : direct.moveSpaceNode(spaceId, input);
}

export async function uploadSpaceFiles(spaceId: string, files: File[], targetDir: string) {
  return (await isLocal(spaceId))
    ? remote.uploadSpaceFiles(spaceId, files, targetDir)
    : direct.uploadSpaceFiles(spaceId, files, targetDir);
}

/**
 * Download source for a file. Cloud spaces may serve via CDN or a local PVC
 * path; local spaces return an in-memory buffer read over RPC. The route
 * renders each variant accordingly.
 */
export type SpaceFileDownload =
  | { kind: "cloud"; spaceId: string; path: string; options?: Visibility }
  | { kind: "buffer"; name: string; mimeType: string | null; buffer: Buffer };

export async function resolveSpaceFileDownload(spaceId: string, path: string, options?: Visibility): Promise<SpaceFileDownload> {
  if (await isLocal(spaceId)) {
    const file = await remote.downloadSpaceFile(spaceId, path, options);
    return { kind: "buffer", ...file };
  }
  return { kind: "cloud", spaceId, path, options };
}

// Re-export provider-independent helpers so callers have a single import site.
export {
  assertSafeRelativePath,
  ensureSpaceWorkspaceReady,
  getMimeType,
  sanitizeFileName,
  spaceFsJsonError,
  streamSpaceFile,
  SpaceFsError,
} from "./space-fs.js";
