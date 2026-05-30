import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { ScannedFile } from "./scan.js";
import { CHECKPOINT_ASSET_MANIFEST_PATH, CHECKPOINT_META_PATH, USER_GIT_REPOS_PATH } from "./paths.js";

export type CheckpointAsset = {
  path: string;
  sha256: string;
  size: number;
  mimeType: string | null;
  objectKey: string;
};

const toPosix = (value: string) => value.replace(/\\/g, "/");

const pointerContent = (asset: CheckpointAsset) => [
  "version https://cohub.run/spec/asset-pointer/v1",
  `sha256 ${asset.sha256}`,
  `size ${asset.size}`,
  ...(asset.mimeType ? [`mime ${asset.mimeType}`] : []),
  `objectKey ${asset.objectKey}`,
  "",
].join("\n");

async function collectExisting(root: string, dir = root): Promise<string[]> {
  const names = await readdir(dir).catch(() => []);
  const nested = await Promise.all(names.map(async (name) => {
    if (dir === root && name === ".git") return [];
    const absPath = join(dir, name);
    const rel = toPosix(relative(root, absPath));
    const st = await lstat(absPath).catch(() => null);
    if (!st) return [];
    if (st.isDirectory() && !st.isSymbolicLink()) return [rel, ...await collectExisting(root, absPath)];
    return [rel];
  }));
  return nested.flat();
}

async function removePath(path: string) {
  await rm(path, { recursive: true, force: true });
}

async function copySmallFile(file: ScannedFile, repoDir: string) {
  const target = join(repoDir, file.path);
  await mkdir(dirname(target), { recursive: true, mode: 0o775 });
  await removePath(target);
  if (file.type === "symlink") {
    const link = await readlink(file.absPath);
    await symlink(link, target);
    return;
  }
  await copyFile(file.absPath, target, constants.COPYFILE_FICLONE).catch(async () => {
    await copyFile(file.absPath, target);
  });
}

export async function syncSystemRepo(input: {
  repoDir: string;
  smallFiles: ScannedFile[];
  assets: CheckpointAsset[];
  gitCheckpointMeta: Record<string, unknown>;
  userGitRepos: Record<string, unknown>;
}) {
  const keep = new Set<string>();
  await Promise.all(input.smallFiles.map(async (file) => {
    keep.add(file.path);
    await copySmallFile(file, input.repoDir);
  }));

  for (const asset of input.assets) {
    keep.add(asset.path);
    const target = join(input.repoDir, asset.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o775 });
    await removePath(target);
    await writeFile(target, pointerContent(asset));
  }

  keep.add(CHECKPOINT_ASSET_MANIFEST_PATH);
  keep.add(CHECKPOINT_META_PATH);
  keep.add(USER_GIT_REPOS_PATH);
  await mkdir(join(input.repoDir, dirname(CHECKPOINT_ASSET_MANIFEST_PATH)), { recursive: true, mode: 0o775 });
  await writeFile(join(input.repoDir, CHECKPOINT_ASSET_MANIFEST_PATH), `${JSON.stringify({ version: 1, assets: input.assets }, null, 2)}\n`);
  await writeFile(join(input.repoDir, CHECKPOINT_META_PATH), `${JSON.stringify(input.gitCheckpointMeta, null, 2)}\n`);
  await writeFile(join(input.repoDir, USER_GIT_REPOS_PATH), `${JSON.stringify(input.userGitRepos, null, 2)}\n`);

  const existing = (await collectExisting(input.repoDir)).sort((a, b) => b.length - a.length);
  for (const rel of existing) {
    if (rel === ".git" || rel.startsWith(".git/")) continue;
    if (rel === ".cohub" || rel === ".cohub/system") continue;
    if (!keep.has(rel)) await removePath(join(input.repoDir, rel));
  }
}
