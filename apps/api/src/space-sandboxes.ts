import { asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { spaceSandboxes, spaces } from "./db/schema-v2.js";
import { sessionsNamespace, config } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";
import { deleteSandboxPublicNetwork, getSandboxPublicEndpoints, reconcileSandboxPublicNetwork } from "./sandbox-public-network.js";
import { createSandboxReportToken, hashSandboxReportToken } from "./crypto.js";
import type { SpaceSandboxStatus } from "./lib/sandbox/types.js";
import type { V1Pod } from "@kubernetes/client-node";

export const toSandboxImageVersion = (image: string) => {
  const normalized = image.trim();
  if (!normalized) return "cohub-sandbox:unknown";
  return normalized.split("/").pop() ?? normalized;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const asMetaObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const getK8sStatusCode = (error: unknown) => {
  return (error as { statusCode?: number; code?: number }).statusCode
    ?? (error as { statusCode?: number; code?: number }).code
    ?? null;
};

const getK8sErrorMessage = (error: unknown) => {
  const body = (error as { body?: unknown }).body;
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
};

export const waitForSandboxPodDeleted = async (podName: string, timeoutMs = 120_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await k8sCoreApi.readNamespacedPod({
        name: podName,
        namespace: sessionsNamespace,
      });
      await sleep(1000);
    } catch (error: unknown) {
      const statusCode = getK8sStatusCode(error);
      if (statusCode === 404) return true;
      throw error;
    }
  }
  return false;
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
  await deleteSandboxPublicNetwork(spaceId);

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

export const mergeSpaceSandboxMeta = async (spaceId: string, metaPatch: Record<string, unknown>) => {
  const [sandbox] = await db
    .update(spaceSandboxes)
    .set({
      meta: sql`(
        CASE
          WHEN jsonb_typeof(${spaceSandboxes.meta}) = 'object' THEN ${spaceSandboxes.meta}
          ELSE '{}'::jsonb
        END
      ) || ${JSON.stringify(metaPatch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(spaceSandboxes.spaceId, spaceId))
    .returning();

  return sandbox ?? null;
};

export const listSandboxRolloutTargets = async (input?: {
  targetImageVersion?: string;
  limit?: number;
}) => {
  const baseQuery = db
    .select({
      spaceId: spaceSandboxes.spaceId,
      userUuid: spaces.userUuid,
      podName: spaceSandboxes.podName,
      status: spaceSandboxes.status,
      desiredImage: spaceSandboxes.desiredImage,
      reportedImageVersion: spaceSandboxes.reportedImageVersion,
      updatedAt: spaceSandboxes.updatedAt,
      createdAt: spaceSandboxes.createdAt,
    })
    .from(spaceSandboxes)
    .innerJoin(spaces, eq(spaceSandboxes.spaceId, spaces.id))
    .orderBy(asc(spaceSandboxes.updatedAt), asc(spaceSandboxes.createdAt));

  if (input?.targetImageVersion) {
    return baseQuery
      .where(or(
        isNull(spaceSandboxes.desiredImage),
        ne(spaceSandboxes.desiredImage, input.targetImageVersion),
        isNull(spaceSandboxes.reportedImageVersion),
        ne(spaceSandboxes.reportedImageVersion, input.targetImageVersion),
      ))
      .limit(input.limit ?? 10_000);
  }

  return baseQuery.limit(input?.limit ?? 10_000);
};

const triggerSandboxPublicNetworkReconcile = (spaceId: string) => {
  void reconcileSandboxPublicNetwork(spaceId)
    .then(async () => {
      await mergeSpaceSandboxMeta(spaceId, {
        publicNetworkStatus: "ready",
        publicNetworkLastError: null,
        publicNetworkReconciledAt: new Date().toISOString(),
        publicEndpoints: getSandboxPublicEndpoints(spaceId),
      });
    })
    .catch(async (error) => {
      await mergeSpaceSandboxMeta(spaceId, {
        publicNetworkStatus: "error",
        publicNetworkLastError: error instanceof Error ? error.message : String(error),
        publicEndpoints: getSandboxPublicEndpoints(spaceId),
      }).catch(() => undefined);
      console.error(`[SandboxPublicNetwork] reconcile failed spaceId=${spaceId}`, error);
    });
};

const tryCreatePod = async (spaceId: string, pod: V1Pod, retry = 0): Promise<{ podName: string; created: boolean }> => {
  try {
    await k8sCoreApi.createNamespacedPod({
      namespace: sessionsNamespace,
      body: pod,
    });
    return { podName: `sandbox-${spaceId}`, created: true };
  } catch (error: unknown) {
    const statusCode = getK8sStatusCode(error);
    const message = getK8sErrorMessage(error).toLowerCase();
    const podName = `sandbox-${spaceId}`;

    if (statusCode === 409 && message.includes("object is being deleted")) {
      const deleted = await waitForSandboxPodDeleted(podName);
      if (!deleted) throw new Error(`timed out waiting for deleted sandbox pod: ${podName}`);
      return tryCreatePod(spaceId, pod, retry + 1);
    }

    if (statusCode === 409 && retry < 10) {
      const backoffMs = Math.min(250 * 2 ** retry, 4000);
      await sleep(backoffMs);
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
  ownerUserUuid?: string;
  mode: "ensure" | "replace";
  reason: "space_created" | "manual_recreate";
}) => {
  const podName = `sandbox-${input.spaceId}`;
  const existingSandbox = await getSpaceSandboxBySpaceId(input.spaceId);
  const existingMeta = asMetaObject(existingSandbox?.meta);

  if (input.mode === "replace") {
    const podToReplace = existingSandbox?.podName ?? podName;
    try {
      await k8sCoreApi.deleteNamespacedPod({
        name: podToReplace,
        namespace: sessionsNamespace,
      });
    } catch (error: unknown) {
      const statusCode = getK8sStatusCode(error);
      if (statusCode !== 404) throw error;
    }

    const deleted = await waitForSandboxPodDeleted(podToReplace);
    if (!deleted) {
      throw new Error(`Timed out waiting for sandbox pod deletion: ${podToReplace}`);
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
    publicNetworkStatus: "provisioning",
    publicNetworkLastError: null,
    publicEndpoints: getSandboxPublicEndpoints(input.spaceId),
  };

  await ensureSpaceSandbox({
    spaceId: input.spaceId,
    status: "provisioning",
    podName,
    desiredImage: toSandboxImageVersion(config.sandboxImage),
    meta: provisioningMeta,
  });

  const pod = renderSandboxPodTemplate({
    SPACE_ID: input.spaceId,
    USER_ID: input.userUuid,
    OWNER_USER_ID: input.ownerUserUuid ?? input.userUuid,
    ENV: config.env,
    SPACE_STORAGE_PVC: config.spaceStoragePvc,
    SPACE_STORAGE_SUBPATH: config.spaceStorageSubpath,
  }) as V1Pod;

  if (pod.spec?.containers?.[0]) {
    pod.spec.containers[0].env = [
      { name: "SPACE_ID", value: input.spaceId },
      { name: "WORKSPACE_DIR", value: "/workspace" },
      { name: "PLATFORM_AGENTS_DIR", value: "/configs/platform/.agents" },
      { name: "USER_AGENTS_DIR", value: "/configs/user/.agents" },
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
    ];
  }

  await tryCreatePod(input.spaceId, pod);

  await updateSpaceSandbox({
    spaceId: input.spaceId,
    status: "provisioning",
    podName,
    desiredImage: toSandboxImageVersion(config.sandboxImage),
    meta: {
      ...provisioningMeta,
      lastProvisionedAt: new Date().toISOString(),
    },
  });

  triggerSandboxPublicNetworkReconcile(input.spaceId);
};

export const provisionSpaceSandbox = async (input: {
  spaceId: string;
  userUuid: string;
  ownerUserUuid?: string;
}) => {
  return reconcileSpaceSandbox({
    spaceId: input.spaceId,
    userUuid: input.userUuid,
    ownerUserUuid: input.ownerUserUuid,
    mode: "ensure",
    reason: "space_created",
  }).catch(async (error) => {
    const existingSandbox = await getSpaceSandboxBySpaceId(input.spaceId);
    const existingMeta = asMetaObject(existingSandbox?.meta);
    await updateSpaceSandbox({
      spaceId: input.spaceId,
      status: "error",
      podName: `sandbox-${input.spaceId}`,
      desiredImage: toSandboxImageVersion(config.sandboxImage),
      meta: {
        ...existingMeta,
        lastError: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => undefined);
    throw error;
  });
};
