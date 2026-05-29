import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, readdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, relative } from "node:path";
import ignore, { type Ignore } from "ignore";

const HARD_EXCLUDES = [
  ".git/",
  "**/.git/",
  ".cohub/system/",
  "**/.cohub/system/",
];

const PLATFORM_IGNORE = `
node_modules/
**/node_modules/
.pnpm-store/
**/.pnpm-store/
.yarn/cache/
**/.yarn/cache/
.yarn/unplugged/
**/.yarn/unplugged/
.yarn/build-state.yml
**/.yarn/build-state.yml
.yarn/install-state.gz
**/.yarn/install-state.gz
.npm/
**/.npm/
dist/
**/dist/
build/
**/build/
.next/
**/.next/
.nuxt/
**/.nuxt/
.svelte-kit/
**/.svelte-kit/
.turbo/
**/.turbo/
.vercel/output/
**/.vercel/output/
.cache/
**/.cache/
.parcel-cache/
**/.parcel-cache/
vite.config.*.timestamp-*
**/vite.config.*.timestamp-*
tsconfig.tsbuildinfo
**/tsconfig.tsbuildinfo
coverage/
**/coverage/
.playwright/
**/.playwright/
test-results/
**/test-results/
*.log
**/*.log
npm-debug.log*
**/npm-debug.log*
yarn-debug.log*
**/yarn-debug.log*
pnpm-debug.log*
**/pnpm-debug.log*
.DS_Store
**/.DS_Store
Thumbs.db
**/Thumbs.db
`;

export type ScannedFile = {
  path: string;
  absPath: string;
  type: "file" | "symlink";
  size: number;
  executable: boolean;
  mimeType: string | null;
};

export type ScanWarning = {
  path: string;
  type: string;
  action: "skipped";
  reason: string;
};

type IgnoreMatcher = {
  baseDir: string;
  matcher: Ignore;
};

const mimeByExt: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".jsx": "text/jsx",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

const getMimeType = (path: string) => mimeByExt[extname(path.toLowerCase())] ?? null;
const normalizeRel = (root: string, absPath: string) => relative(root, absPath).replace(/\\/g, "/");
const pathForIgnore = (path: string, isDirectory: boolean) => (isDirectory && !path.endsWith("/") ? `${path}/` : path);

async function readGitignore(dir: string): Promise<IgnoreMatcher | null> {
  const content = await readFile(join(dir, ".gitignore"), "utf8").catch(() => null);
  if (!content) return null;
  return { baseDir: dir, matcher: ignore().add(content) };
}

export const hashFile = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});

const isSafeSymlinkTarget = (target: string) => {
  if (isAbsolute(target)) return false;
  const normalized = normalize(target).replace(/\\/g, "/");
  return normalized !== ".." && !normalized.startsWith("../");
};

const isIgnoredByMatchers = (absPath: string, isDirectory: boolean, matchers: IgnoreMatcher[]) => {
  for (const { baseDir, matcher } of matchers) {
    const rel = normalizeRel(baseDir, absPath);
    if (!rel || rel.startsWith("../")) continue;
    if (matcher.ignores(pathForIgnore(rel, isDirectory))) return true;
  }
  return false;
};

export async function scanWorkspace(root: string) {
  const candidates: ScannedFile[] = [];
  const warnings: ScanWarning[] = [];
  let ignoredCount = 0;

  const systemMatcher = ignore().add(HARD_EXCLUDES).add(PLATFORM_IGNORE);

  const walk = async (dir: string, inheritedMatchers: IgnoreMatcher[]) => {
    const localMatcher = await readGitignore(dir);
    const matchers = localMatcher ? [...inheritedMatchers, localMatcher] : inheritedMatchers;
    const names = await readdir(dir).catch(() => []);

    await Promise.all(names.map(async (name) => {
      const absPath = join(dir, name);
      const rel = normalizeRel(root, absPath);
      const st = await lstat(absPath).catch(() => null);
      if (!st) return;
      const isDirectory = st.isDirectory() && !st.isSymbolicLink();
      const ignorePath = pathForIgnore(rel, isDirectory);

      if (systemMatcher.ignores(ignorePath) || isIgnoredByMatchers(absPath, isDirectory, matchers)) {
        ignoredCount += 1;
        return;
      }

      if (isDirectory) return walk(absPath, matchers);
      if (st.isFile()) {
        candidates.push({
          path: rel,
          absPath,
          type: "file",
          size: st.size,
          executable: (st.mode & 0o111) !== 0,
          mimeType: getMimeType(basename(rel)),
        });
        return;
      }
      if (st.isSymbolicLink()) {
        const target = await readlink(absPath).catch(() => null);
        if (!target || !isSafeSymlinkTarget(target)) {
          warnings.push({ path: rel, type: "symlink", action: "skipped", reason: "unsafe_symlink_target" });
          return;
        }
        candidates.push({ path: rel, absPath, type: "symlink", size: st.size, executable: false, mimeType: null });
        return;
      }
      warnings.push({ path: rel, type: st.isSocket() ? "socket" : st.isFIFO() ? "fifo" : st.isBlockDevice() ? "block_device" : st.isCharacterDevice() ? "char_device" : "unknown", action: "skipped", reason: "unsupported_file_type" });
    }));
  };

  await walk(root, []);
  return { files: candidates.sort((a, b) => a.path.localeCompare(b.path)), warnings, ignoredCount };
}
