import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const USER_CONFIG_PUBLISH_WHITELIST = [
  "AGENTS.md",
  "CLAUDE.md",
  ".agents",
  ".cohub",
] as const;
const USER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COPY_DEPTH = 16;

function assertValidUserId(userId: string) {
  const value = userId.trim();
  if (!USER_ID_REGEX.test(value)) {
    throw new Error(`Invalid userId: ${userId}`);
  }
  return value;
}

export const getPublishedUserConfigDir = (userId: string) => {
  return join(config.spaceStorageRoot, "configs", "users", assertValidUserId(userId));
};

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyRecursive(src: string, dest: string, depth = 0): Promise<void> {
  if (depth > MAX_COPY_DEPTH) {
    throw new Error(`config publish exceeded max depth at ${src}`);
  }

  const info = await lstat(src);
  if (info.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in published config: ${src}`);
  }

  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true, mode: 0o775 });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(join(src, entry.name), join(dest, entry.name), depth + 1);
    }
    return;
  }

  await mkdir(dirname(dest), { recursive: true, mode: 0o775 });
  await copyFile(src, dest);
}

async function copyIfExists(srcRoot: string, destRoot: string, relativePath: string) {
  const src = join(srcRoot, relativePath);
  if (!(await pathExists(src))) return false;
  await copyRecursive(src, join(destRoot, relativePath));
  return true;
}

export interface PublishConfigResult {
  targetDir: string;
  copiedPaths: string[];
  meta: Record<string, unknown>;
}

export async function publishConfigFromWorkspace(input: {
  workspaceDir: string;
  checkpointId: string;
  targetDir: string;
  whitelist: readonly string[];
  sourceLabel: string;
}): Promise<PublishConfigResult> {
  const opId = `${input.checkpointId}-${randomUUID()}`;
  const tmpDir = `${input.targetDir}.__tmp__.${opId}`;
  const backupDir = `${input.targetDir}.__bak__.${opId}`;

  await rm(tmpDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true, mode: 0o775 });

  const copiedPaths: string[] = [];
  for (const relativePath of input.whitelist) {
    if (await copyIfExists(input.workspaceDir, tmpDir, relativePath)) {
      copiedPaths.push(relativePath);
    }
  }

  const meta = {
    sourceSpaceId: input.sourceLabel,
    sourceCheckpointId: input.checkpointId,
    publishedAt: new Date().toISOString(),
    copiedPaths,
  };
  await mkdir(join(tmpDir, ".cohub"), { recursive: true, mode: 0o775 });
  await writeFile(join(tmpDir, ".cohub", "config-meta.json"), JSON.stringify(meta, null, 2));

  // Recursively chmod everything under a directory to ensure it can be deleted.
  // This handles cases where files were created with restrictive permissions
  // (e.g. git objects with 0444, different UID in init containers, etc.).
  const forceChmod = async (dir: string): Promise<void> => {
    // Directories need write permission to allow unlinking their contents
    await chmod(dir, 0o777).catch(() => undefined);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await forceChmod(fullPath);
      } else {
        // Make files writable so they can be unlinked
        await chmod(fullPath, 0o666).catch(() => undefined);
      }
    }
  };

  // Aggressively remove a directory tree, handling permission issues.
  // Falls back to iterating and removing individual entries when recursive rm fails.
  const forceRm = async (dir: string): Promise<void> => {
    await rm(dir, { recursive: true, force: true }).catch(async () => {
      // If recursive rm fails, try to remove contents iteratively
      await forceChmod(dir);
      const entries = await readdir(dir).catch(() => [] as string[]);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        await rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
      }
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });
  };

  const hadExistingTarget = await pathExists(input.targetDir);
  try {
    if (hadExistingTarget) {
      await rename(input.targetDir, backupDir);
    }
    await rename(tmpDir, input.targetDir);
    if (hadExistingTarget) {
      await forceChmod(backupDir);
      await forceRm(backupDir);
    }
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    if (hadExistingTarget && (await pathExists(backupDir)) && !(await pathExists(input.targetDir))) {
      await forceChmod(backupDir).catch(() => undefined);
      await rename(backupDir, input.targetDir).catch(() => undefined);
    }
    throw error;
  }

  return {
    targetDir: input.targetDir,
    copiedPaths,
    meta,
  };
}

export async function publishUserConfigFromWorkspace(input: {
  userId: string;
  spaceId: string;
  checkpointId: string;
  workspaceDir: string;
}): Promise<PublishConfigResult> {
  return publishConfigFromWorkspace({
    workspaceDir: input.workspaceDir,
    checkpointId: input.checkpointId,
    targetDir: getPublishedUserConfigDir(input.userId),
    whitelist: USER_CONFIG_PUBLISH_WHITELIST,
    sourceLabel: input.spaceId,
  });
}

export async function readPublishedUserConfigMeta(userId: string) {
  const metaPath = join(getPublishedUserConfigDir(userId), ".cohub", "config-meta.json");
  const raw = await readFile(metaPath, "utf-8").catch(() => null);
  return raw ? JSON.parse(raw) as Record<string, unknown> : null;
}
