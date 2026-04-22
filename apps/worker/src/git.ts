import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { config } from "./config.js";

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

export const runGitWithOutput = async (args: string[], cwd: string) => {
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

export const buildAuthenticatedRemoteUrl = (input: {
  username: string;
  accessToken: string;
  repoName: string;
}) => {
  const base = new URL(config.giteaBaseUrl);
  base.username = input.username;
  base.password = input.accessToken;
  base.pathname = `/${input.username}/${input.repoName}.git`;
  return base.toString();
};
