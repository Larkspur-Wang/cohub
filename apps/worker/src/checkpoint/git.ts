import { spawn } from "node:child_process";

const redactBasicAuthUrls = (value: string) =>
  value.replace(/(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/g, "$1***$3");

export const runGitWithOutput = async (args: string[], cwd: string) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("git", ["-c", `safe.directory=${cwd}`, ...args], {
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
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(redactBasicAuthUrls(stderr.trim() || `git ${args[0]} exited with non-zero status ${code}`)));
    });
  });
};

export const runGit = async (args: string[], cwd: string) => {
  await runGitWithOutput(args, cwd);
};

export const ensureGitRepo = async (repoDir: string, branch = "main") => {
  const hasGit = await runGit(["rev-parse", "--git-dir"], repoDir).then(() => true, () => false);
  if (!hasGit) {
    await runGit(["init", "-b", branch], repoDir).catch(async () => {
      await runGit(["init"], repoDir);
      await runGit(["checkout", "-B", branch], repoDir);
    });
  }
  await runGit(["config", "user.name", "Cohub Worker"], repoDir);
  await runGit(["config", "user.email", "noreply@cohub.run"], repoDir);
  await runGit(["checkout", "-B", branch], repoDir);
};
