import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";

const createKubeClient = () => {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  return kubeConfig.makeApiClient(CoreV1Api);
};

export const k8sCoreApi = createKubeClient();
