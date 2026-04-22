import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { spaceSandboxes } from "./db/schema-v2.js";
import { sessionsNamespace, config } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";
import { createSandboxReportToken, hashSandboxReportToken } from "./crypto.js";
import type { SpaceSandboxStatus } from "@cohub/protocol";
import type { V1Pod } from "@kubernetes/client-node";

export const toSandboxImageVersion = (image: string) => {
  const normalized = image.trim();
  if (!normalized) return "cohub-sandbox:unknown";
  return normalized.split("/").pop() ?? normalized;
};

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
  desiredImage?: string | null;
  reportedImageVersion?: string | null;
  reportedAt?: Date | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [sandbox] = await db
    .insert(spaceSandboxes)
    .values({
      spaceId: input.spaceId,
      status: input.status ?? "pending",
      podName: input.podName ?? null,
      desiredImage: input.desiredImage ?? null,
      reportedImageVersion: input.reportedImageVersion ?? null,
      reportedAt: input.reportedAt ?? null,
      meta: input.meta ?? null,
    })
    .onConflictDoUpdate({
      target: spaceSandboxes.spaceId,
      set: {
        status: input.status ?? "pending",
        podName: input.podName ?? null,
        ...(input.desiredImage !== undefined ? { desiredImage: input.desiredImage } : {}),
        ...(input.reportedImageVersion !== undefined ? { reportedImageVersion: input.reportedImageVersion } : {}),
        ...(input.reportedAt !== undefined ? { reportedAt: input.reportedAt } : {}),
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
  desiredImage?: string | null;
  reportedImageVersion?: string | null;
  reportedAt?: Date | null;
  lastHeartbeatAt?: Date | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [sandbox] = await db
    .update(spaceSandboxes)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.podName !== undefined ? { podName: input.podName } : {}),
      ...(input.desiredImage !== undefined ? { desiredImage: input.desiredImage } : {}),
      ...(input.reportedImageVersion !== undefined ? { reportedImageVersion: input.reportedImageVersion } : {}),
      ...(input.reportedAt !== undefined ? { reportedAt: input.reportedAt } : {}),
      ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
      updatedAt: new Date(),
    })
    .where(eq(spaceSandboxes.spaceId, input.spaceId))
    .returning();

  return sandbox ?? null;
};

const tryCreatePod = async (spaceId: string, pod: V1Pod, retry = 0): Promise<{ podName: string; created: boolean }> => {
  try {
    await k8sCoreApi.createNamespacedPod({
      namespace: sessionsNamespace,
      body: pod,
    });
    return { podName: `sandbox-${spaceId}`, created: true };
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409 && retry < 10) {
      const backoffMs = Math.min(250 * 2 ** retry, 4000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return tryCreatePod(spaceId, pod, retry + 1);
    }
    if (statusCode === 409) {
      throw new Error(`sandbox pod already exists after retries: sandbox-${spaceId}`);
    }
    throw error;
  }
};

export const reconcileSpaceSandbox = async (input: {
  spaceId: string;
  userUuid: string;
  mode: "ensure" | "replace";
  reason: "space_created" | "manual_recreate";
  extraEnv?: Array<{ name: string; value: string }>;
}) => {
  const podName = `sandbox-${input.spaceId}`;
  const existingSandbox = await getSpaceSandboxBySpaceId(input.spaceId);
  const existingMeta = (existingSandbox?.meta as Record<string, unknown> | null) ?? {};

  if (input.mode === "replace" && existingSandbox?.podName) {
    try {
      await k8sCoreApi.deleteNamespacedPod({
        name: existingSandbox.podName,
        namespace: sessionsNamespace,
      });
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw error;
    }
  }

  const reportToken = createSandboxReportToken();
  const reportTokenHash = hashSandboxReportToken(reportToken);
  const reportTokenIssuedAt = new Date().toISOString();
  const nowIso = new Date().toISOString();
  const provisioningMeta = {
    ...existingMeta,
    ...(input.mode === "replace" ? { recreatedAt: nowIso } : {}),
    reconcileReason: input.reason,
    provisioningStartedAt: nowIso,
    reportTokenHash,
    reportTokenIssuedAt,
  };

  await ensureSpaceSandbox({
    spaceId: input.spaceId,
    status: "provisioning",
    podName,
    desiredImage: config.sandboxImage,
    meta: provisioningMeta,
  });

  const pod = renderSandboxPodTemplate({
    SPACE_ID: input.spaceId,
    USER_ID: input.userUuid,
    ENV: config.env,
    SPACE_STORAGE_PVC: config.spaceStoragePvc,
    SPACE_STORAGE_SUBPATH: config.spaceStorageSubpath,
  }) as V1Pod;

  if (pod.spec?.containers?.[0]) {
    pod.spec.containers[0].env = [
      { name: "SPACE_ID", value: input.spaceId },
      { name: "WORKSPACE_DIR", value: "/workspace" },
      { name: "PLATFORM_AGENTS_DIR", value: "/configs/platform/.agents" },
      { name: "IMAGE_VERSION", value: toSandboxImageVersion(config.sandboxImage) },
      { name: "POD_IP", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
      {
        name: "INTERNAL_API_BASE_URL",
        value:
          config.env === "prod"
            ? "http://cohub-api.cohub.svc.cluster.local:8787"
            : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787",
      },
      {
        name: "PUBLIC_URL_PREFIX",
        value:
          config.env === "prod"
            ? `https://public.cohub.run/s/${input.spaceId}`
            : `https://public.cohub.run/dev/s/${input.spaceId}`,
      },
      { name: "SANDBOX_REPORT_TOKEN", value: reportToken },
      ...(input.extraEnv ?? []),
    ];
  }

  await tryCreatePod(input.spaceId, pod);

  await updateSpaceSandbox({
    spaceId: input.spaceId,
    status: "provisioning",
    podName,
    desiredImage: config.sandboxImage,
    meta: {
      ...provisioningMeta,
      lastProvisionedAt: new Date().toISOString(),
    },
  });
};

export const provisionSpaceSandbox = async (input: {
  spaceId: string;
  userUuid: string;
  extraEnv?: Array<{ name: string; value: string }>;
}) => {
  return reconcileSpaceSandbox({
    spaceId: input.spaceId,
    userUuid: input.userUuid,
    mode: "ensure",
    reason: "space_created",
    extraEnv: input.extraEnv,
  }).catch(async (error) => {
    const existingSandbox = await getSpaceSandboxBySpaceId(input.spaceId);
    const existingMeta = (existingSandbox?.meta as Record<string, unknown> | null) ?? {};
    await updateSpaceSandbox({
      spaceId: input.spaceId,
      status: "error",
      podName: `sandbox-${input.spaceId}`,
      desiredImage: config.sandboxImage,
      meta: {
        ...existingMeta,
        lastError: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);
    throw error;
  });
};


