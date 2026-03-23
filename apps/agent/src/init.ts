import { spawn } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { GLOBAL_CONFIG_REPO, env } from "./env.js";
import { setRuntimeStatus } from "./redis.js";

async function runGitClone(repositoryUrl: string, targetDir: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["clone", repositoryUrl, targetDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() || `git clone exited with non-zero status ${code}`,
        ),
      );
    });
  });
}

async function copyConfigToHome(sourceDir: string, name: string) {
  const homeDir = process.env.HOME || "/root";
  const targetDir = join(homeDir, name);
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });
  console.log(`[Init] Copied ${name} to ${targetDir}`);
}

export async function initializeContainer() {
  console.log(
    `[Init] Starting container initialization for runtime: ${env.RUNTIME_ID}`,
  );
  await setRuntimeStatus("starting");

  try {
    await mkdir(env.WORKSPACE_DIR, { recursive: true });
    console.log(`[Init] Workspace directory ready: ${env.WORKSPACE_DIR}`);
  } catch (error) {
    console.error("[Init] Failed to create workspace directory:", error);
    throw error;
  }

  const tempDir = join("/tmp", `configs-${Date.now()}`);
  try {
    console.log(`[Init] Cloning config repo from ${GLOBAL_CONFIG_REPO}...`);
    await runGitClone(GLOBAL_CONFIG_REPO, tempDir);
    console.log("[Init] Config repo cloned successfully.");

    const entries = await readdir(tempDir);
    for (const entry of entries) {
      if (entry === ".git") continue;
      const entryPath = join(tempDir, entry);
      const stats = await stat(entryPath);
      if (stats.isDirectory()) {
        await copyConfigToHome(entryPath, entry);
      }
    }

    console.log("[Init] All configs applied to home directory.");
  } catch (error) {
    console.error("[Init] Failed to clone or apply configs:", error);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log("[Init] Container initialization completed.");
}
