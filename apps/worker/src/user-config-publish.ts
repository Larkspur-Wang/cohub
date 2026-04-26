import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const USER_CONFIG_PUBLISH_WHITELIST = [
  "AGENTS.md",
  "CLAUDE.md",
  ".agents",
  ".pi/agent/models.json",
] as const;
const USER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    throw new Error(`user config publish exceeded max depth at ${src}`);
  }

  const info = await lstat(src);
  if (info.isSymbolicLink()) {
    throw new Error(`symbolic links are not allowed in published user config: ${src}`);
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

export async function publishUserConfigFromWorkspace(input: {
  userId: string;
  spaceId: string;
  checkpointId: string;
  workspaceDir: string;
}) {
  const targetDir = getPublishedUserConfigDir(input.userId);
  const opId = `${input.checkpointId}-${randomUUID()}`;
  const tmpDir = `${targetDir}.__tmp__.${opId}`;
  const backupDir = `${targetDir}.__bak__.${opId}`;

  await rm(tmpDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true, mode: 0o775 });

  const copiedPaths: string[] = [];
  for (const relativePath of USER_CONFIG_PUBLISH_WHITELIST) {
    if (await copyIfExists(input.workspaceDir, tmpDir, relativePath)) {
      copiedPaths.push(relativePath);
    }
  }

  const meta = {
    sourceSpaceId: input.spaceId,
    sourceCheckpointId: input.checkpointId,
    publishedAt: new Date().toISOString(),
    copiedPaths,
  };
  await mkdir(join(tmpDir, ".cohub"), { recursive: true, mode: 0o775 });
  await writeFile(join(tmpDir, ".cohub", "config-meta.json"), JSON.stringify(meta, null, 2));

  const hadExistingTarget = await pathExists(targetDir);
  try {
    if (hadExistingTarget) {
      await rename(targetDir, backupDir);
    }
    await rename(tmpDir, targetDir);
    if (hadExistingTarget) {
      await rm(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    if (hadExistingTarget && (await pathExists(backupDir)) && !(await pathExists(targetDir))) {
      await rename(backupDir, targetDir).catch(() => undefined);
    }
    throw error;
  }

  return {
    targetDir,
    copiedPaths,
    meta,
  };
}

export async function readPublishedUserConfigMeta(userId: string) {
  const metaPath = join(getPublishedUserConfigDir(userId), ".cohub", "config-meta.json");
  const raw = await readFile(metaPath, "utf-8").catch(() => null);
  return raw ? JSON.parse(raw) as Record<string, unknown> : null;
}
