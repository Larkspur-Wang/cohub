import { Writable } from "node:stream";
import type { V1Status } from "@kubernetes/client-node";
import { Exec } from "@kubernetes/client-node";
import { kubeConfig } from "../../k8s.js";

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
      const output = await execInSandboxPod(namespace, podName, script, Math.min(10_000, Math.max(1000, deadline - Date.now())));
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

const k8sExec = new Exec(kubeConfig);

const execInSandboxPod = (namespace: string, podName: string, script: string, timeoutMs: number) => {
  return new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let socket: { close: () => void } | null = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(`${stdout}${stderr ? `\n${stderr}` : ""}`.trim());
    };

    const timer = setTimeout(() => {
      socket?.close();
      finish(new Error(`kubernetes exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const stdoutStream = new Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString();
        callback();
      },
    });
    const stderrStream = new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString();
        callback();
      },
    });

    k8sExec.exec(
      namespace,
      podName,
      "sandbox",
      ["sh", "-lc", script],
      stdoutStream,
      stderrStream,
      null,
      false,
      (status: V1Status) => {
        const exitCode = status.details?.causes?.find((cause) => cause.reason === "ExitCode")?.message;
        if (status.status === "Success" || exitCode === "0") {
          finish();
          return;
        }
        const message = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
        finish(new Error(`kubernetes exec failed${exitCode ? ` with code ${exitCode}` : ""}: ${message || status.message || status.reason || "unknown error"}`));
      },
    ).then((ws) => {
      socket = ws;
      ws.on("error", (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    }).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
};
