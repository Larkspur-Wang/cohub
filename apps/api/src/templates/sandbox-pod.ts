import { config } from "../config.js";

type SandboxPodTemplateVariables = {
  SPACE_ID: string;
  USER_ID: string;
  ENV?: string;
  SPACE_REPO_URL?: string;
  SPACE_GIT_USERNAME?: string;
  SPACE_GIT_EMAIL?: string;
  SPACE_STORAGE_PVC?: string;
  SPACE_STORAGE_SUBPATH?: string;
};

function assertK8sSafeName(value: string, fieldName: string) {
  if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error(
      `${fieldName} must be 1-63 chars of lowercase letters, numbers, or hyphens`,
    );
  }
}


export const SANDBOX_POD_TEMPLATE = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: {
    name: "sandbox-${SPACE_ID}",
    labels: {
      app: "agent-sandbox",
      "space-id": "${SPACE_ID}",
      "user-id": "${USER_ID}",
    },
  },
  spec: {
    restartPolicy: "Never",
    imagePullSecrets: [{ name: "gitea-registry" }],
    containers: [
      {
        name: "sandbox",
        image: config.sandboxImage,
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
            name: "space-storage",
            mountPath: "/workspace",
            subPath: "${SPACE_STORAGE_SUBPATH}/${SPACE_ID}/workspace",
          },
          {
            name: "public-storage",
            mountPath: "/public",
            subPath:
              config.env === "prod"
                ? "r/${SPACE_ID}"
                : "dev/r/${SPACE_ID}",
          },
        ],
      },
    ],
    volumes: [
      {
        name: "space-storage",
        persistentVolumeClaim: {
          claimName: "${SPACE_STORAGE_PVC}",
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
  assertK8sSafeName(variables.SPACE_ID, "SPACE_ID");
  assertK8sSafeName(variables.USER_ID, "USER_ID");
  return variables;
}

export type { SandboxPodTemplateVariables };
