import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { spaceSandboxes } from "./db/schema-v2.js";
import { sessionsNamespace, config } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import { renderSandboxPodTemplate, renderSandboxServiceTemplate } from "./sandbox-template.js";
import type { SpaceSandboxStatus } from "@cohub/protocol";
import type { V1Pod, V1Service } from "@kubernetes/client-node";

export const getSpaceSandboxBySpaceId = async (spaceId: string) => {
  const [sandbox] = await db
    .select()
    .from(spaceSandboxes)
    .where(eq(spaceSandboxes.spaceId, spaceId))
    .limit(1);

  return sandbox ?? null;
};

export const ensureSpaceSandbox = async (input: {
  spaceId: string;
  status?: SpaceSandboxStatus;
  podName?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [sandbox] = await db
    .insert(spaceSandboxes)
    .values({
      spaceId: input.spaceId,
      status: input.status ?? "pending",
      podName: input.podName ?? null,
      meta: input.meta ?? null,
    })
    .onConflictDoUpdate({
      target: spaceSandboxes.spaceId,
      set: {
        status: input.status ?? "pending",
        podName: input.podName ?? null,
        meta: input.meta ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!sandbox) throw new Error("Failed to ensure space sandbox");
  return sandbox;
};

export const deleteSpaceSandbox = async (spaceId: string) => {
  const [sandbox] = await db
    .delete(spaceSandboxes)
    .where(eq(spaceSandboxes.spaceId, spaceId))
    .returning();

  return sandbox ?? null;
};

export const updateSpaceSandbox = async (input: {
  spaceId: string;
  status?: SpaceSandboxStatus;
  podName?: string | null;
  lastHeartbeatAt?: Date | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [sandbox] = await db
    .update(spaceSandboxes)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.podName !== undefined ? { podName: input.podName } : {}),
      ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
      updatedAt: new Date(),
    })
    .where(eq(spaceSandboxes.spaceId, input.spaceId))
    .returning();

  return sandbox ?? null;
};

const tryCreatePod = async (spaceId: string, pod: V1Pod) => {
  try {
    await k8sCoreApi.createNamespacedPod({
      namespace: sessionsNamespace,
      body: pod,
    });
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      // Ignore conflict if pod already exists
      return { podName: `sandbox-${spaceId}` };
    }
    throw error;
  }
  return { podName: `sandbox-${spaceId}` };
};

const tryCreateService = async (spaceId: string, service: V1Service) => {
  try {
    await k8sCoreApi.createNamespacedService({
      namespace: sessionsNamespace,
      body: service,
    });
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      // Ignore conflict if service already exists
      return;
    }
    throw error;
  }
};

export const provisionSpaceInBackground = async (input: {
  spaceId: string;
  userUuid: string;
  spaceRepoUrl?: string;
  spaceGitUsername?: string;
  spaceGitEmail?: string;
  extraEnv?: Array<{ name: string; value: string }>;
}) => {
  const podName = `sandbox-${input.spaceId}`;

  try {
    await ensureSpaceSandbox({
      spaceId: input.spaceId,
      status: "provisioning",
      podName,
      meta: { provisioningStartedAt: new Date().toISOString() },
    });

    const pod = renderSandboxPodTemplate({
      SPACE_ID: input.spaceId,
      USER_ID: input.userUuid,
      ENV: config.env,
      SPACE_REPO_URL: input.spaceRepoUrl,
      SPACE_GIT_USERNAME: input.spaceGitUsername,
      SPACE_GIT_EMAIL: input.spaceGitEmail,
      SPACE_STORAGE_PVC: config.spaceStoragePvc,
      SPACE_STORAGE_SUBPATH: config.spaceStorageSubpath,
    }) as V1Pod;

    const internalApiBaseUrl = config.env === "prod"
      ? "http://cohub-api.cohub.svc.cluster.local:8787"
      : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787";

    if (pod.spec?.containers?.[0]) {
      pod.spec.containers[0].env = [
        { name: "SPACE_ID", value: input.spaceId },
        { name: "SANDBOX_WS_HOST", value: "0.0.0.0" },
        { name: "SANDBOX_WS_PORT", value: "8788" },
        { name: "WORKSPACE_DIR", value: "/workspace" },
        { name: "IMAGE_VERSION", value: config.sandboxImage },
        { name: "COHUB_API_URL", value: internalApiBaseUrl },
        { name: "COHUB_ENV", value: config.env },
        { name: "SPACE_REPO_URL", value: input.spaceRepoUrl ?? "" },
        { name: "SPACE_GIT_USERNAME", value: input.spaceGitUsername ?? "" },
        { name: "SPACE_GIT_EMAIL", value: input.spaceGitEmail ?? "" },
        ...(input.extraEnv ?? []),
      ];
    }

    const service = renderSandboxServiceTemplate({ SPACE_ID: input.spaceId }) as V1Service;
    await tryCreateService(input.spaceId, service);

    await tryCreatePod(input.spaceId, pod);

    await updateSpaceSandbox({
      spaceId: input.spaceId,
      status: "provisioning",
      podName,
      meta: {
        lastProvisionedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    await updateSpaceSandbox({
      spaceId: input.spaceId,
      status: "error",
      podName,
      meta: { lastError: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
  }
};
