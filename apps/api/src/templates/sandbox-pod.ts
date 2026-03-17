type SandboxPodTemplateVariables = {
  SESSION_ID: string;
  USER_ID: string;
  RUNTIME_IMAGE: string;
  REDIS_URL: string;
};

function assertK8sSafeName(value: string, fieldName: string) {
  if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error(
      `${fieldName} must be 1-63 chars of lowercase letters, numbers, or hyphens`,
    );
  }
}

function assertRuntimeImage(value: string) {
  if (!/^[a-z0-9./:_-]{1,255}$/.test(value)) {
    throw new Error("RUNTIME_IMAGE contains invalid characters");
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
    name: "sandbox-${SESSION_ID}",
    labels: {
      app: "agent-sandbox",
      "session-id": "${SESSION_ID}",
      "user-id": "${USER_ID}",
    },
  },
  spec: {
    restartPolicy: "Never",
    containers: [
      {
        name: "runtime",
        image: "${RUNTIME_IMAGE}",
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
          { name: "SESSION_ID", value: "${SESSION_ID}" },
          { name: "REDIS_URL", value: "${REDIS_URL}" },
          { name: "WORKSPACE_DIR", value: "/workspace" },
        ],
        volumeMounts: [
          {
            name: "workspace-storage",
            mountPath: "/workspace",
            subPath: "${SESSION_ID}",
          },
        ],
      },
    ],
    volumes: [
      {
        name: "workspace-storage",
        persistentVolumeClaim: {
          claimName: "netaverses-nas-pvc",
        },
      },
    ],
  },
};

export function validateSandboxPodTemplateVariables(
  variables: SandboxPodTemplateVariables,
) {
  assertK8sSafeName(variables.SESSION_ID, "SESSION_ID");
  assertK8sSafeName(variables.USER_ID, "USER_ID");
  assertRuntimeImage(variables.RUNTIME_IMAGE);
  assertRedisUrl(variables.REDIS_URL);
  return variables;
}

export type { SandboxPodTemplateVariables };
