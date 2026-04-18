import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { spaceSandboxes } from "./db/schema-v2.js";
import { sessionsNamespace, config } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";
import type { SpaceSandboxStatus } from "@cohub/protocol";
import type { V1Pod } from "@kubernetes/client-node";

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
  await k8sCoreApi.createNamespacedPod({
    namespace: sessionsNamespace,
    body: pod,
  });
  return { podName: `sandbox-${spaceId}` };
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
    await updateSpaceSandbox({
      spaceId: input.spaceId,
      status: "provisioning",
      podName,
      meta: { provisioningStartedAt: new Date().toISOString() },
    });

    const pod = renderSandboxPodTemplate({
      SPACE_ID: input.spaceId,
      USER_ID: input.userUuid,
      AGENT_WS_BASE_URL: config.agentWsBaseUrl,
      ENV: config.env,
      SPACE_REPO_URL: input.spaceRepoUrl,
      SPACE_GIT_USERNAME: input.spaceGitUsername,
      SPACE_GIT_EMAIL: input.spaceGitEmail,
      SPACE_STORAGE_PVC: config.spaceStoragePvc,
      SPACE_STORAGE_SUBPATH: config.spaceStorageSubpath,
    }) as V1Pod;

    if (pod.spec?.containers?.[0]) {
      pod.spec.containers[0].env = [
        { name: "SPACE_ID", value: input.spaceId },
        { name: "SANDBOX_WS_URL", value: `${config.agentWsBaseUrl.replace(/\/$/, "")}/sandbox` },
        { name: "WORKSPACE_DIR", value: "/workspace" },
        { name: "IMAGE_VERSION", value: config.sandboxImage },
        { name: "SPACE_REPO_URL", value: input.spaceRepoUrl ?? "" },
        { name: "SPACE_GIT_USERNAME", value: input.spaceGitUsername ?? "" },
        { name: "SPACE_GIT_EMAIL", value: input.spaceGitEmail ?? "" },
        ...(input.extraEnv ?? []),
      ];
    }

    await tryCreatePod(input.spaceId, pod);

    await updateSpaceSandbox({
      spaceId: input.spaceId,
      status: "provisioning",
      podName,
      meta: {
        lastProvisionedAt: new Date().toISOString(),
        agentWsBaseUrl: config.agentWsBaseUrl,
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
