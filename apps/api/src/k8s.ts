import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";

const createKubeClient = () => {
  const kubeConfig = new KubeConfig();

  const kubeconfigPath = process.env.KUBECONFIG;
  if (kubeconfigPath) {
    kubeConfig.loadFromFile(kubeconfigPath);
  } else {
    kubeConfig.loadFromDefault();
  }

  return kubeConfig.makeApiClient(CoreV1Api);
};

export const k8sCoreApi = createKubeClient();
