import { createSandboxLifecycleController, type SandboxInfraAdapter } from "@cohub/sandbox-controller";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { config } from "../../../config.js";
import { registerSystemJob } from "../../registry.js";
import { SANDBOX_IDLE_REAPER_JOB } from "./types.js";

const getSessionsNamespace = () => config.env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";
const getIdleTtlMs = () => Number(process.env.SANDBOX_IDLE_TTL_MS ?? 48 * 60 * 60_000);
const getLimit = () => Number(process.env.SANDBOX_IDLE_REAPER_LIMIT ?? 50);

const getK8sCoreApi = async () => {
  const { CoreV1Api, KubeConfig } = await import("@kubernetes/client-node");
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  return kubeConfig.makeApiClient(CoreV1Api);
};

const getK8sStatusCode = (error: unknown) => {
  return (error as { statusCode?: number; code?: number }).statusCode
    ?? (error as { statusCode?: number; code?: number }).code
    ?? null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const infra: SandboxInfraAdapter = {
  async deletePod(input) {
    const k8sCoreApi = await getK8sCoreApi();
    await k8sCoreApi.deleteNamespacedPod({
      name: input.podName,
      namespace: getSessionsNamespace(),
    }).catch((error: unknown) => {
      if (getK8sStatusCode(error) !== 404) throw error;
    });
  },
  async waitForPodDeleted(input) {
    const k8sCoreApi = await getK8sCoreApi();
    const timeoutMs = input.timeoutMs ?? 120_000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        await k8sCoreApi.readNamespacedPod({
          name: input.podName,
          namespace: getSessionsNamespace(),
        });
        await sleep(1000);
      } catch (error: unknown) {
        if (getK8sStatusCode(error) === 404) return true;
        throw error;
      }
    }
    return false;
  },
  async resumeSandbox() {
    throw new Error("system worker does not resume sandboxes");
  },
};

const sandboxLifecycle = createSandboxLifecycleController({
  db,
  redis: redisCommandClient,
  infra,
});

registerSystemJob(SANDBOX_IDLE_REAPER_JOB, async () => {
  const result = await sandboxLifecycle.reapIdleSandboxes({
    limit: getLimit(),
  });
  console.log("[SandboxReaper] completed", JSON.stringify(result));
  return result;
});
