import type { SandboxInfraAdapter } from "@cohub/sandbox-controller";
import { config } from "../config.js";

const getSessionsNamespace = () => config.env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";

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

export const sandboxInfra: SandboxInfraAdapter = {
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
