import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { GLOBAL_PI_CONFIG_REPO, env } from "./env.js";
import { setSessionStatus } from "./redis.js";

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

export async function initializeContainer() {
  console.log(
    `[Init] Starting container initialization for session: ${env.SESSION_ID}`,
  );
  await setSessionStatus("starting");

  // Ensure workspace directory exists
  try {
    await mkdir(env.WORKSPACE_DIR, { recursive: true });
    console.log(`[Init] Workspace directory ready: ${env.WORKSPACE_DIR}`);
  } catch (error) {
    console.error("[Init] Failed to create workspace directory:", error);
    throw error;
  }

  const piDir = join(process.env.HOME || "/root", ".pi");
  try {
    console.log(
      `[Init] Cloning global config from ${GLOBAL_PI_CONFIG_REPO} to ${piDir}...`,
    );
    await rm(piDir, { recursive: true, force: true });
    await runGitClone(GLOBAL_PI_CONFIG_REPO, piDir);
    console.log("[Init] Global config cloned successfully.");
  } catch (error) {
    console.error("[Init] Failed to clone global config:", error);
    throw error;
  }

  console.log("[Init] Container initialization completed.");
}
