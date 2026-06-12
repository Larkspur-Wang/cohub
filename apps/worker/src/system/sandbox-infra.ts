import { SANDBOX_PUBLIC_PORTS } from "@cohub/protocol/ports";
import {
  getSandboxPublicRouteName,
  getSandboxPublicServiceName,
  SANDBOX_PUBLIC_NETWORK_HTTP_ROUTE_GROUP,
  SANDBOX_PUBLIC_NETWORK_HTTP_ROUTE_PLURAL,
  SANDBOX_PUBLIC_NETWORK_HTTP_ROUTE_VERSION,
  type SandboxInfraAdapter,
} from "@cohub/sandbox-controller";
import { config } from "../config.js";

const getSessionsNamespace = () => config.env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";

const getK8sCoreApi = async () => {
  const { CoreV1Api, KubeConfig } = await import("@kubernetes/client-node");
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  return kubeConfig.makeApiClient(CoreV1Api);
};

const getK8sCustomObjectsApi = async () => {
  const { CustomObjectsApi, KubeConfig } = await import("@kubernetes/client-node");
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  return kubeConfig.makeApiClient(CustomObjectsApi);
};

const getK8sStatusCode = (error: unknown) => {
  return (error as { statusCode?: number; code?: number }).statusCode
    ?? (error as { statusCode?: number; code?: number }).code
    ?? null;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
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
  async deletePublicNetwork(input) {
    const namespace = getSessionsNamespace();
    const [k8sCoreApi, k8sCustomObjectsApi] = await Promise.all([
      getK8sCoreApi(),
      getK8sCustomObjectsApi(),
    ]);

    const tasks = [
      ...SANDBOX_PUBLIC_PORTS.map(async (port) => {
        try {
          await k8sCustomObjectsApi.deleteNamespacedCustomObject({
            group: SANDBOX_PUBLIC_NETWORK_HTTP_ROUTE_GROUP,
            version: SANDBOX_PUBLIC_NETWORK_HTTP_ROUTE_VERSION,
            namespace,
            plural: SANDBOX_PUBLIC_NETWORK_HTTP_ROUTE_PLURAL,
            name: getSandboxPublicRouteName(input.spaceId, port),
          });
        } catch (error: unknown) {
          if (getK8sStatusCode(error) !== 404) throw error;
        }
      }),
      (async () => {
        try {
          await k8sCoreApi.deleteNamespacedService({
            name: getSandboxPublicServiceName(input.spaceId),
            namespace,
          });
        } catch (error: unknown) {
          if (getK8sStatusCode(error) !== 404) throw error;
        }
      })(),
    ];

    const results = await Promise.allSettled(tasks);
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => getErrorMessage(result.reason));
    if (errors.length > 0) {
      throw new Error(`failed to delete sandbox public network: ${errors.join("; ")}`);
    }
  },
  async resumeSandbox() {
    throw new Error("system worker does not resume sandboxes");
  },
};
