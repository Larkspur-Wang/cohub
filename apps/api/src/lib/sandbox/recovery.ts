import { spawn } from "node:child_process";

export type SandboxInfraErrorCode = "STALE_MOUNT" | "CRITICAL_MOUNT_IO";

const CRITICAL_MOUNT_PREFIXES = [
  "/workspace",
  "/configs/platform/.agents",
  "/configs/user/.agents",
  "/sessions",
  "/public",
];

const normalize = (value: string) => value.toLowerCase();

export const classifySandboxInfraError = (message: string): {
  code: SandboxInfraErrorCode;
  requiresPodRecreate: true;
  mountPath?: string;
} | null => {
  const normalized = normalize(message);
  const mountPath = CRITICAL_MOUNT_PREFIXES.find((prefix) => normalized.includes(prefix.toLowerCase()));
  if (!mountPath) return null;

  if (normalized.includes("stale nfs file handle") || normalized.includes("stale file handle") || normalized.includes("estale")) {
    return { code: "STALE_MOUNT", requiresPodRecreate: true, mountPath };
  }

  if (
    normalized.includes("input/output error") ||
    normalized.includes("transport endpoint is not connected") ||
    normalized.includes("not a directory")
  ) {
    return { code: "CRITICAL_MOUNT_IO", requiresPodRecreate: true, mountPath };
  }

  return null;
};

export const isSandboxInfraError = (message: string) => classifySandboxInfraError(message) !== null;

export const smokeVerifySandboxPod = async (podName: string, namespace: string, timeoutMs = 45_000) => {
  const script = [
    "set -eu",
    "stat /workspace >/dev/null",
    "stat /sessions >/dev/null",
    "stat /public >/dev/null",
    "stat /configs/platform/.agents/skills >/dev/null",
    "printf ok > /tmp/.cohub-healthcheck",
    "grep -q ok /tmp/.cohub-healthcheck",
    "printf '{\"workspace\":true,\"sessions\":true,\"public\":true,\"platformAgents\":true,\"tmp\":true}'",
  ].join("\n");

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const output = await kubectlExec(namespace, podName, script, Math.min(10_000, Math.max(1000, deadline - Date.now())));
      const jsonStart = output.indexOf("{");
      if (jsonStart < 0) throw new Error(`smoke verify returned no json: ${output}`);
      return JSON.parse(output.slice(jsonStart)) as Record<string, boolean>;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const kubectlExec = (namespace: string, podName: string, script: string, timeoutMs: number) => {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("kubectl", ["-n", namespace, "exec", podName, "--", "sh", "-lc", script], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`kubectl exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
      if (code === 0) resolve(output);
      else reject(new Error(`kubectl exec failed with code ${code}: ${output}`));
    });
  });
};
