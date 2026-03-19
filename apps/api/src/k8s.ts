import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const createKubeClient = () => {
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
      console.warn(`KUBECONFIG file not found: ${kubeconfigPath}, falling back to default`);
      kubeConfig.loadFromDefault();
    }
  } else {
    kubeConfig.loadFromDefault();
  }

  return kubeConfig.makeApiClient(CoreV1Api);
};

export const k8sCoreApi = createKubeClient();
