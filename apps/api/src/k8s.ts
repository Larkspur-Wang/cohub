import { CoreV1Api, CustomObjectsApi, KubeConfig } from "@kubernetes/client-node";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-api" });
const createKubeConfig = () => {
  const kubeConfig = new KubeConfig();

  let kubeconfigPath = process.env.KUBECONFIG;
  if (kubeconfigPath) {
    // Expand ~ to home directory
    if (kubeconfigPath.startsWith("~")) {
      kubeconfigPath = homedir() + kubeconfigPath.slice(1);
    }
    if (existsSync(kubeconfigPath)) {
      kubeConfig.loadFromFile(kubeconfigPath);
    } else {
      logger.warn(
        `KUBECONFIG file not found: ${kubeconfigPath}, falling back to default`,
      );
      kubeConfig.loadFromDefault();
    }
  } else {
    kubeConfig.loadFromDefault();
  }

  return kubeConfig;
};

export const kubeConfig = createKubeConfig();

export const k8sCoreApi = kubeConfig.makeApiClient(CoreV1Api);
export const k8sCustomObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi);
