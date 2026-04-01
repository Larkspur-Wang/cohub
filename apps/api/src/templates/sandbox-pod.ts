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
          {
            name: "public-storage",
            mountPath: "/public",
            subPath:
              config.env === "prod"
                ? "r/${RUNTIME_ID}"
                : "dev/r/${RUNTIME_ID}",
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
      {
        name: "public-storage",
        persistentVolumeClaim: {
          claimName: "cohub-sessions-public-pvc",
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
