import { chmod, mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-worker" });
const redactBasicAuthUrls = (value: string) =>
  value.replace(/(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/g, "$1***$3");

export const getSpaceWorkspaceDir = (spaceId: string) => `${config.spaceStorageRoot}/${spaceId}/workspace`;

export const ensureSpaceWorkspaceReady = async (spaceId: string) => {
  const spaceBaseDir = `${config.spaceStorageRoot}/${spaceId}`;
  const workspaceDir = getSpaceWorkspaceDir(spaceId);
  await mkdir(spaceBaseDir, { recursive: true, mode: 0o775 });
  await mkdir(workspaceDir, { recursive: true, mode: 0o775 });
  await Promise.all([
    chmod(spaceBaseDir, 0o775).catch(() => undefined),
    chmod(workspaceDir, 0o775).catch(() => undefined),
  ]);
  return { spaceBaseDir, workspaceDir };
};

export const emptyDirectory = async (dir: string) => {
  const names = await readdir(dir).catch(() => []);
  await Promise.all(names.map((name) => rm(join(dir, name), { recursive: true, force: true })));
};

/**
 * Remove stale `.git/index.lock` if it exists and no git process is holding it.
 *
 * When a git process crashes (e.g. OOM, SIGKILL) or the container restarts
 * mid-operation, the lock file is left behind and all subsequent git commands
 * fail with "Unable to create ... index.lock: File exists".
 */
export const cleanStaleGitLock = async (cwd: string) => {
  const lockPath = join(cwd, ".git", "index.lock");
  try {
    const st = await stat(lockPath);
    // If the lock file is older than 30 seconds, consider it stale.
    // A fresh git operation would have a very recent mtime.
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs > 30_000) {
      await unlink(lockPath);
      logger.warn(`[git] removed stale index.lock (age=${Math.round(ageMs / 1000)}s) cwd=${cwd}`);
    }
  } catch {
    // lock file doesn't exist or already removed — nothing to do
  }
};

export const runGitWithOutput = async (args: string[], cwd: string) => {
  // Clean stale lock before any git operation to prevent index.lock failures.
  await cleanStaleGitLock(cwd);

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    // Allow git to operate in directories owned by different uids (common in container + PVC env)
    const safeArgs = ["-c", `safe.directory=${cwd}`, ...args];
    const child = spawn("git", safeArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(redactBasicAuthUrls(stderr.trim() || `git ${args[0]} exited with non-zero status ${code}`)));
    });
  });
};

export const runGit = async (args: string[], cwd: string) => {
  await runGitWithOutput(args, cwd);
};
