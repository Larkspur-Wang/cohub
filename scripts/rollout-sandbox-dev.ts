#!/usr/bin/env tsx
process.env.COHUB_API_NAMESPACE = process.env.COHUB_API_NAMESPACE || "cohub-dev";
process.env.COHUB_API_LABEL = process.env.COHUB_API_LABEL || "app.kubernetes.io/name=cohub-api";
process.env.KUBECONFIG = process.env.KUBECONFIG || "~/.kube/config_us";
import("./rollout-sandbox.ts").catch((error) => {
  console.error(error);
  process.exit(1);
});
