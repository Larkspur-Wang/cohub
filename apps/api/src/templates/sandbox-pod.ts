import { config } from "../config.js";

type SandboxPodTemplateVariables = {
  RUNTIME_ID: string;
  USER_ID: string;
  REDIS_URL: string;
  LITELLM_API_KEY?: string;
  ENV?: string;
  WORKSPACE_REPO_URL?: string;
  WORKSPACE_GIT_USERNAME?: string;
  WORKSPACE_GIT_EMAIL?: string;
};

function assertK8sSafeName(value: string, fieldName: string) {
  if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error(
      `${fieldName} must be 1-63 chars of lowercase letters, numbers, or hyphens`,
    );
  }
}

function assertRedisUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("REDIS_URL must be a valid URL");
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
}

export const SANDBOX_POD_TEMPLATE = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: {
    name: "sandbox-${RUNTIME_ID}",
    labels: {
      app: "agent-sandbox",
      "runtime-id": "${RUNTIME_ID}",
      "user-id": "${USER_ID}",
    },
  },
  spec: {
    restartPolicy: "Never",
    imagePullSecrets: [{ name: "gitea-registry" }],
    containers: [
      {
        name: "runtime",
        image: config.sandboxRuntimeImage,
        resources: {
          limits: {
            cpu: "1",
            memory: "2Gi",
          },
          requests: {
            cpu: "0.1",
            memory: "256Mi",
          },
        },
        env: [
          { name: "RUNTIME_ID", value: "${RUNTIME_ID}" },
          { name: "REDIS_URL", value: "${REDIS_URL}" },
          { name: "ENV", value: "${ENV}" },
          { name: "WORKSPACE_DIR", value: "/workspace" },
          { name: "SESSIONS_DIR", value: "/sessions" },
          { name: "LITELLM_API_KEY", value: "${LITELLM_API_KEY}" },
          { name: "WORKSPACE_REPO_URL", value: "${WORKSPACE_REPO_URL}" },
          { name: "WORKSPACE_GIT_USERNAME", value: "${WORKSPACE_GIT_USERNAME}" },
          { name: "WORKSPACE_GIT_EMAIL", value: "${WORKSPACE_GIT_EMAIL}" },
        ],
        volumeMounts: [
          {
            name: "workspace-storage",
            mountPath: "/workspace",
            subPath: "cohub-${ENV}/${RUNTIME_ID}/workspace",
          },
          {
            name: "workspace-storage",
            mountPath: "/sessions",
            subPath: "cohub-${ENV}/${RUNTIME_ID}/sessions",
          },
        ],
      },
    ],
    volumes: [
      {
        name: "workspace-storage",
        persistentVolumeClaim: {
          claimName: "cohub-sessions-pvc",
        },
      },
    ],
  },
};

export function validateSandboxPodTemplateVariables(
  variables: SandboxPodTemplateVariables,
) {
  assertK8sSafeName(variables.RUNTIME_ID, "RUNTIME_ID");
  assertK8sSafeName(variables.USER_ID, "USER_ID");
  assertRedisUrl(variables.REDIS_URL);
  return variables;
}

export type { SandboxPodTemplateVariables };
