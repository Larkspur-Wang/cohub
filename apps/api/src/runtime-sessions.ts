import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { V1Pod } from "@kubernetes/client-node";
import type {
  PersistMessageInput,
  PersistSessionInfoUpdateInput,
  PersistToolCall,
  RegisterRuntimeSessionInput,
  UnifiedContentBlock,
} from "@cohub/protocol";
import { db } from "./db/index.js";
import {
  runtimeSessions,
  runtimes,
  sessionMessages,
  sessionToolCalls,
  runtimeChannels,
  workspaces,
} from "./db/schema.js";
import { config, sessionsNamespace } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import {
  getRuntimeInputQueueKey,
  getRuntimeMetaKey,
  getRuntimeOutputStreamKey,
  getRuntimeProvisionMetaKey,
  getRuntimeProvisionStreamKey,
  redisCommandClient,
  createStreamingRedisClient,
} from "./redis.js";
import type { RedisStreamEntry } from "./redis.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";
import { bindRuntimeChannelsToGateway, dispatchOutboundMessage, getBindingsBySessionId, touchRuntimeSessionBinding } from "./channels.js";
import { ensureUserGitAccount } from "./git-accounts.js";

export type SessionMessageBlock = UnifiedContentBlock;

type RuntimeProvisionStatus = "queued" | "running" | "succeeded" | "failed";
type RuntimeProvisionLevel = "info" | "success" | "error";
type RuntimeProvisionStep =
  | "queued"
  | "init_git_account"
  | "prepare_workspace"
  | "create_pod"
  | "bind_channels"
  | "wait_runtime_running"
  | "completed";

type RuntimeProvisionEvent = {
  id: string;
  at: string;
  level: RuntimeProvisionLevel;
  status: RuntimeProvisionStatus;
  step: RuntimeProvisionStep;
  message: string;
  meta?: Record<string, unknown> | null;
};

export type RuntimeProvisionSnapshot = {
  runtimeId: string;
  status: RuntimeProvisionStatus;
  currentStep: RuntimeProvisionStep;
  currentMessage: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  events: RuntimeProvisionEvent[];
};

type RuntimeEnvVar = {
  name: string;
  value: string;
};

const PROVISION_EVENT_LIMIT = 100;
const RESERVED_RUNTIME_ENV_NAMES = new Set([
  "RUNTIME_ID",
  "REDIS_URL",
  "WORKSPACE_DIR",
  "LITELLM_API_KEY",
  "ENV",
  "WORKSPACE_REPO_URL",
  "WORKSPACE_GIT_USERNAME",
  "WORKSPACE_GIT_EMAIL",
]);

const nowIso = () => new Date().toISOString();

const logProvision = (
  runtimeId: string,
  step: RuntimeProvisionStep,
  phase: "start" | "success" | "error",
  details?: Record<string, unknown>,
) => {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  const logger = phase === "error" ? console.error : console.log;
  logger(`[RuntimeProvision] runtimeId=${runtimeId} step=${step} phase=${phase}${suffix}`);
};

const mapProvisionStepToRuntimeStatus = (step: RuntimeProvisionStep) => {
  switch (step) {
    case "queued":
      return "active";
    case "completed":
      return "running";
    default:
      return "starting";
  }
};

const updateRuntimeStatus = async (runtimeId: string, status: string) => {
  await db
    .update(runtimes)
    .set({ status, updatedAt: new Date() })
    .where(eq(runtimes.id, runtimeId));
};

export const normalizeRuntimeEnv = (input: unknown): RuntimeEnvVar[] => {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (item): item is { name?: unknown; value?: unknown } =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      value: String(item.value ?? ""),
    }))
    .filter((item) => item.name.length > 0);
};

export const validateRuntimeEnv = (envs: RuntimeEnvVar[]) => {
  if (envs.length > 50) {
    throw new Error("extraEnv cannot exceed 50 entries");
  }

  const seen = new Set<string>();
  for (const env of envs) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(env.name)) {
      throw new Error(`invalid env name: ${env.name}`);
    }

    if (env.name.length > 128) {
      throw new Error(`env name too long: ${env.name}`);
    }

    if (env.value.length > 4000) {
      throw new Error(`env value too long for: ${env.name}`);
    }

    if (RESERVED_RUNTIME_ENV_NAMES.has(env.name)) {
      throw new Error(`env name is reserved: ${env.name}`);
    }

    if (seen.has(env.name)) {
      throw new Error(`duplicate env name: ${env.name}`);
    }

    seen.add(env.name);
  }
};

const getRuntimeExtraEnv = (runtimeMeta: unknown): RuntimeEnvVar[] => {
  if (!runtimeMeta || typeof runtimeMeta !== "object") return [];
  const extraEnv = (runtimeMeta as { extraEnv?: unknown }).extraEnv;
  return normalizeRuntimeEnv(extraEnv);
};

const buildRuntimeContainerEnv = (input: {
  runtimeId: string;
  redisUrl: string;
  litellmApiKey?: string;
  env?: string;
  workspaceRepoUrl?: string;
  workspaceGitUsername?: string;
  workspaceGitEmail?: string;
  extraEnv?: RuntimeEnvVar[];
}) => {
  return [
    { name: "RUNTIME_ID", value: input.runtimeId },
    { name: "REDIS_URL", value: input.redisUrl },
    { name: "WORKSPACE_DIR", value: "/workspace" },
    { name: "LITELLM_API_KEY", value: input.litellmApiKey ?? "" },
    { name: "ENV", value: input.env ?? "" },
    { name: "WORKSPACE_REPO_URL", value: input.workspaceRepoUrl ?? "" },
    { name: "WORKSPACE_GIT_USERNAME", value: input.workspaceGitUsername ?? "" },
    { name: "WORKSPACE_GIT_EMAIL", value: input.workspaceGitEmail ?? "" },
    ...(input.extraEnv ?? []),
  ];
};

export const writeInitialRuntimeProvision = async (runtimeId: string) => {
  const key = getRuntimeProvisionMetaKey(runtimeId);
  const timestamp = nowIso();

  await redisCommandClient.hset(key, {
    runtime_id: runtimeId,
    status: "queued",
    current_step: "queued",
    current_message: "Runtime created. Waiting to start background provisioning.",
    error: "",
    started_at: timestamp,
    finished_at: "",
    updated_at: timestamp,
  });
};

const appendProvisionEvent = async (
  runtimeId: string,
  event: RuntimeProvisionEvent,
) => {
  const streamKey = getRuntimeProvisionStreamKey(runtimeId);
  await redisCommandClient.xadd(
    streamKey,
    "MAXLEN",
    "~",
    PROVISION_EVENT_LIMIT,
    "*",
    "payload",
    JSON.stringify(event),
  );
};

const writeProvisionMeta = async (
  runtimeId: string,
  input: {
    status: RuntimeProvisionStatus;
    currentStep: RuntimeProvisionStep;
    currentMessage: string;
    error?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  },
) => {
  const key = getRuntimeProvisionMetaKey(runtimeId);
  const updatedAt = nowIso();

  await redisCommandClient.hset(key, {
    runtime_id: runtimeId,
    status: input.status,
    current_step: input.currentStep,
    current_message: input.currentMessage,
    error: input.error ?? "",
    started_at: input.startedAt ?? updatedAt,
    finished_at: input.finishedAt ?? "",
    updated_at: updatedAt,
  });
};

const pushProvisionEvent = async (
  runtimeId: string,
  input: {
    status: RuntimeProvisionStatus;
    step: RuntimeProvisionStep;
    level: RuntimeProvisionLevel;
    message: string;
    meta?: Record<string, unknown> | null;
    error?: string | null;
    markFinished?: boolean;
    syncRuntimeStatus?: boolean;
  },
) => {
  const timestamp = nowIso();
  await writeProvisionMeta(runtimeId, {
    status: input.status,
    currentStep: input.step,
    currentMessage: input.message,
    error: input.error ?? null,
    startedAt: undefined,
    finishedAt: input.markFinished ? timestamp : undefined,
  });

  await appendProvisionEvent(runtimeId, {
    id: randomUUID(),
    at: timestamp,
    level: input.level,
    status: input.status,
    step: input.step,
    message: input.message,
    meta: input.meta ?? null,
  });

  if (input.syncRuntimeStatus) {
    await updateRuntimeStatus(runtimeId, mapProvisionStepToRuntimeStatus(input.step));
  }
};

export const initializeRuntimeProvision = async (runtimeId: string) => {
  await writeInitialRuntimeProvision(runtimeId);
};

export const getRuntimeProvision = async (
  runtimeId: string,
): Promise<RuntimeProvisionSnapshot> => {
  const meta = await redisCommandClient.hgetall(getRuntimeProvisionMetaKey(runtimeId));

  const streamKey = getRuntimeProvisionStreamKey(runtimeId);
  const entries = await redisCommandClient.xrevrange(streamKey, "+", "-", "COUNT", PROVISION_EVENT_LIMIT);

  const events = (entries as RedisStreamEntry[])
    .map(([, fields]) => {
      const payloadIndex = fields.findIndex((field) => field === "payload");
      const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
      if (!payload) return null;
      try {
        return JSON.parse(payload) as RuntimeProvisionEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is RuntimeProvisionEvent => Boolean(event))
    .reverse();

  return {
    runtimeId,
    status: (meta.status as RuntimeProvisionStatus) || "queued",
    currentStep: (meta.current_step as RuntimeProvisionStep) || "queued",
    currentMessage: meta.current_message || null,
    error: meta.error || null,
    startedAt: meta.started_at || null,
    finishedAt: meta.finished_at || null,
    updatedAt: meta.updated_at || null,
    events,
  };
};

export const createRuntime = async (input: {
  userUuid: string;
  workspaceId?: string | null;
  agentId?: string | null;
  title?: string | null;
  cwd?: string | null;
  protocol?: "pi" | "acp" | "internal" | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [runtime] = await db
    .insert(runtimes)
    .values({
      userUuid: input.userUuid,
      workspaceId: input.workspaceId ?? null,
      agentId: input.agentId ?? null,
      title: input.title ?? null,
      status: "active",
      meta: {
        cwd: input.cwd ?? null,
        protocol: input.protocol ?? "pi",
        ...(input.meta ?? {}),
      },
    })
    .returning();

  if (!runtime) throw new Error("Failed to create runtime");
  return { runtime };
};

export const createInitialRuntimeSession = async (input: RegisterRuntimeSessionInput) => {
  const [session] = await db
    .insert(runtimeSessions)
    .values({
      id: input.sessionId,
      runtimeId: input.runtimeId,
      title: input.title ?? null,
      status: "active",
      cwd: input.cwd ?? null,
      protocol: input.protocol ?? "pi",
      externalSessionId: input.externalSessionId ?? null,
      meta: input.meta ?? null,
    })
    .returning();

  if (!session) throw new Error("Failed to create initial runtime session");

  await db
    .update(runtimes)
    .set({ currentSessionId: session.id, updatedAt: new Date() })
    .where(eq(runtimes.id, input.runtimeId));

  return session;
};

export const registerRuntimeSession = async (input: RegisterRuntimeSessionInput) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) throw new Error("Runtime not found");

  try {
    const [session] = await db
      .insert(runtimeSessions)
      .values({
        id: input.sessionId,
        runtimeId: input.runtimeId,
        title: input.title ?? runtime.title ?? null,
        status: "active",
        cwd: input.cwd ?? null,
        protocol: input.protocol ?? "pi",
        externalSessionId: input.externalSessionId ?? null,
        meta: input.meta ?? null,
      })
      .returning();

    if (!session) throw new Error("Failed to register runtime session");

    if (!runtime.currentSessionId) {
      await db
        .update(runtimes)
        .set({ currentSessionId: session.id, updatedAt: new Date() })
        .where(eq(runtimes.id, runtime.id));
    }

    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("duplicate key") ||
      message.includes("already exists") ||
      message.includes("unique")
    ) {
      const [existing] = await db
        .select()
        .from(runtimeSessions)
        .where(eq(runtimeSessions.id, input.sessionId))
        .limit(1);

      if (existing) {
        if (!runtime.currentSessionId) {
          await db
            .update(runtimes)
            .set({ currentSessionId: existing.id, updatedAt: new Date() })
            .where(eq(runtimes.id, runtime.id));
        }
        return existing;
      }
    }

    throw error;
  }
};

export const launchRuntimeSandbox = async (input: {
  runtimeId: string;
  userUuid: string;
}) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) throw new Error("Runtime not found");

  const extraEnv = getRuntimeExtraEnv(runtime.meta);
  validateRuntimeEnv(extraEnv);

  let workspaceRepoUrl: string | undefined;
  let workspaceGitUsername: string | undefined;
  let workspaceGitEmail: string | undefined;

  if (runtime.workspaceId) {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, runtime.workspaceId))
      .limit(1);

    if (workspace) {
      const gitAccount = await ensureUserGitAccount(input.userUuid);
      workspaceGitUsername = gitAccount.giteaUsername;
      workspaceGitEmail = `${gitAccount.giteaUsername}@${config.giteaManagedEmailDomain}`;

      // Construct authenticated URL: https://<username>:<token>@gitea.example.com/<username>/<repo>.git
      const url = new URL(config.giteaBaseUrl);
      workspaceRepoUrl = `${url.protocol}//${gitAccount.giteaUsername}:${gitAccount.giteaAccessToken}@${url.host}/${gitAccount.giteaUsername}/${workspace.giteaRepoName}.git`;
    }
  }

  const pod = renderSandboxPodTemplate({
    RUNTIME_ID: input.runtimeId,
    USER_ID: input.userUuid,
    REDIS_URL: config.redisUrl,
    LITELLM_API_KEY: config.litellmApiKey,
    ENV: config.env,
    WORKSPACE_REPO_URL: workspaceRepoUrl,
    WORKSPACE_GIT_USERNAME: workspaceGitUsername,
    WORKSPACE_GIT_EMAIL: workspaceGitEmail,
  }) as V1Pod;

  if (pod.spec?.containers?.[0]) {
    pod.spec.containers[0].env = buildRuntimeContainerEnv({
      runtimeId: input.runtimeId,
      redisUrl: config.redisUrl,
      litellmApiKey: config.litellmApiKey,
      env: config.env,
      workspaceRepoUrl,
      workspaceGitUsername,
      workspaceGitEmail,
      extraEnv,
    });
  }

  await k8sCoreApi.createNamespacedPod({
    namespace: sessionsNamespace,
    body: pod,
  });

  // 拉起关联的 IM Channels
  await bindRuntimeChannelsToGateway(input.runtimeId).catch(console.error);

  return pod;
};

export const provisionRuntimeInBackground = async (input: {
  runtimeId: string;
  userUuid: string;
}) => {
  const runtimeId = input.runtimeId;

  try {
    logProvision(runtimeId, "queued", "start");
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "init_git_account",
      level: "info",
      message: "Initializing git account.",
      syncRuntimeStatus: true,
    });

    const runtime = await getRuntimeById(runtimeId);
    if (!runtime) throw new Error("Runtime not found");

    const extraEnv = getRuntimeExtraEnv(runtime.meta);
    validateRuntimeEnv(extraEnv);

    let workspaceRepoUrl: string | undefined;
    let workspaceGitUsername: string | undefined;
    let workspaceGitEmail: string | undefined;
    let workspaceRepoName: string | null = null;

    if (runtime.workspaceId) {
      logProvision(runtimeId, "init_git_account", "start", { workspaceId: runtime.workspaceId });
      const gitAccount = await ensureUserGitAccount(input.userUuid);
      workspaceGitUsername = gitAccount.giteaUsername;
      workspaceGitEmail = `${gitAccount.giteaUsername}@${config.giteaManagedEmailDomain}`;
      logProvision(runtimeId, "init_git_account", "success", {
        giteaUsername: gitAccount.giteaUsername,
      });
      await pushProvisionEvent(runtimeId, {
        status: "running",
        step: "init_git_account",
        level: "success",
        message: "Git account initialized successfully.",
        meta: { giteaUsername: gitAccount.giteaUsername },
      });

      logProvision(runtimeId, "prepare_workspace", "start", { workspaceId: runtime.workspaceId });
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, runtime.workspaceId))
        .limit(1);

      if (workspace) {
        workspaceRepoName = workspace.giteaRepoName;
        const url = new URL(config.giteaBaseUrl);
        workspaceRepoUrl = `${url.protocol}//${gitAccount.giteaUsername}:${gitAccount.giteaAccessToken}@${url.host}/${gitAccount.giteaUsername}/${workspace.giteaRepoName}.git`;
      }

      logProvision(runtimeId, "prepare_workspace", "success", {
        hasWorkspace: Boolean(workspace),
        repo: workspaceRepoName,
      });
      await pushProvisionEvent(runtimeId, {
        status: "running",
        step: "prepare_workspace",
        level: "success",
        message: workspaceRepoName
          ? `Workspace prepared: ${workspaceRepoName}.`
          : "No workspace repository found. Continuing without repository bootstrap.",
        meta: workspaceRepoName ? { repo: workspaceRepoName } : null,
      });
    } else {
      await pushProvisionEvent(runtimeId, {
        status: "running",
        step: "prepare_workspace",
        level: "info",
        message: "No workspace attached. Skipping workspace preparation.",
      });
    }

    const pod = renderSandboxPodTemplate({
      RUNTIME_ID: runtimeId,
      USER_ID: input.userUuid,
      REDIS_URL: config.redisUrl,
      LITELLM_API_KEY: config.litellmApiKey,
      ENV: config.env,
      WORKSPACE_REPO_URL: workspaceRepoUrl,
      WORKSPACE_GIT_USERNAME: workspaceGitUsername,
      WORKSPACE_GIT_EMAIL: workspaceGitEmail,
    }) as V1Pod;

    if (pod.spec?.containers?.[0]) {
      pod.spec.containers[0].env = buildRuntimeContainerEnv({
        runtimeId,
        redisUrl: config.redisUrl,
        litellmApiKey: config.litellmApiKey,
        env: config.env,
        workspaceRepoUrl,
        workspaceGitUsername,
        workspaceGitEmail,
        extraEnv,
      });
    }

    const podName = pod.metadata?.name ?? `runtime-${runtimeId}`;

    logProvision(runtimeId, "create_pod", "start", {
      namespace: sessionsNamespace,
      podName,
    });
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "create_pod",
      level: "info",
      message: "Creating runtime pod.",
      meta: { namespace: sessionsNamespace, podName },
    });

    await k8sCoreApi.createNamespacedPod({
      namespace: sessionsNamespace,
      body: pod,
    });

    logProvision(runtimeId, "create_pod", "success", {
      namespace: sessionsNamespace,
      podName,
    });
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "create_pod",
      level: "success",
      message: "Runtime pod created successfully.",
      meta: { namespace: sessionsNamespace, podName },
    });

    logProvision(runtimeId, "bind_channels", "start");
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "bind_channels",
      level: "info",
      message: "Binding runtime channels.",
    });
    await bindRuntimeChannelsToGateway(runtimeId);
    logProvision(runtimeId, "bind_channels", "success");
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "bind_channels",
      level: "success",
      message: "Runtime channels bound successfully.",
    });

    logProvision(runtimeId, "wait_runtime_running", "start");
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "wait_runtime_running",
      level: "info",
      message: "Waiting for runtime to report running status.",
    });

    const ready = await waitForRuntimeRunning(runtimeId, 30000);
    if (!ready) {
      const liveStatus = await getRuntimeLiveStatus(runtimeId);
      logProvision(runtimeId, "wait_runtime_running", "error", {
        liveStatus,
      });
      await pushProvisionEvent(runtimeId, {
        status: "failed",
        step: "wait_runtime_running",
        level: "error",
        message: "Runtime did not reach running state within timeout.",
        error: liveStatus ? `last live status: ${liveStatus}` : "timeout waiting for runtime status",
        meta: { liveStatus },
        markFinished: true,
        syncRuntimeStatus: true,
      });
      await updateRuntimeStatus(runtimeId, liveStatus || "error");
      return;
    }

    logProvision(runtimeId, "wait_runtime_running", "success");
    await pushProvisionEvent(runtimeId, {
      status: "running",
      step: "wait_runtime_running",
      level: "success",
      message: "Runtime reported running status.",
    });

    logProvision(runtimeId, "completed", "success");
    await pushProvisionEvent(runtimeId, {
      status: "succeeded",
      step: "completed",
      level: "success",
      message: "Runtime startup completed successfully.",
      markFinished: true,
      syncRuntimeStatus: true,
    });
    await updateRuntimeStatus(runtimeId, "running");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logProvision(runtimeId, "completed", "error", { error: message });
    await pushProvisionEvent(runtimeId, {
      status: "failed",
      step: "completed",
      level: "error",
      message: "Runtime startup failed.",
      error: message,
      meta: { error: message },
      markFinished: true,
      syncRuntimeStatus: true,
    }).catch(() => undefined);
    await updateRuntimeStatus(runtimeId, "error").catch(() => undefined);
  }
};

export const waitForRuntimeRunning = async (runtimeId: string, timeoutMs = 30000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await redisCommandClient.hget(getRuntimeMetaKey(runtimeId), "status");
    if (status === "running") return true;
    if (status === "error" || status === "stopped") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
};

export const getRuntimeLiveStatus = async (runtimeId: string) => {
  const status = await redisCommandClient.hget(getRuntimeMetaKey(runtimeId), "status");
  return status?.trim() || null;
};

export const enqueueRuntimePrompt = async (input: {
  runtimeId: string;
  sessionId: string;
  userMessageId?: string | null;
  branchFromMessageId?: string | null;
  message: {
    text: string;
    images?: Array<{ url: string }>;
  };
  meta?: Record<string, unknown> | null;
}) => {
  await redisCommandClient.rpush(
    getRuntimeInputQueueKey(input.runtimeId),
    JSON.stringify({
      action: "prompt",
      id: randomUUID(),
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      userMessageId: input.userMessageId ?? null,
      branchFromMessageId: input.branchFromMessageId ?? null,
      message: input.message,
      meta: input.meta ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
};

export const getRuntimeById = async (runtimeId: string) => {
  const [runtime] = await db
    .select()
    .from(runtimes)
    .where(eq(runtimes.id, runtimeId))
    .limit(1);
  return runtime ?? null;
};

export const getRuntimeSessionById = async (runtimeSessionId: string) => {
  const [session] = await db
    .select()
    .from(runtimeSessions)
    .where(eq(runtimeSessions.id, runtimeSessionId))
    .limit(1);
  return session ?? null;
};

export const listRuntimeSessions = async (runtimeId: string) => {
  return db
    .select()
    .from(runtimeSessions)
    .where(eq(runtimeSessions.runtimeId, runtimeId))
    .orderBy(asc(runtimeSessions.createdAt));
};

export const readRuntimeOutputStream = async (input: {
  runtimeId: string;
  lastEventId?: string;
  blockMs?: number;
  signal?: AbortSignal;
}) => {
  const streamKey = getRuntimeOutputStreamKey(input.runtimeId);
  const startId = input.lastEventId?.trim() || "$";
  const blockMs = input.blockMs ?? 15000;
  const client = createStreamingRedisClient();

  await client.connect().catch(() => undefined);
  let currentId = startId;

  const close = async () => {
    await client.quit().catch(async () => {
      await client.disconnect();
    });
  };

  const iterator = (async function* () {
    try {
      while (!input.signal?.aborted) {
        const response = await client.xread(
          "BLOCK",
          blockMs,
          "STREAMS",
          streamKey,
          currentId,
        );
        if (!response) continue;

        for (const [, entries] of response as Array<[string, RedisStreamEntry[]]>) {
          for (const [id, fields] of entries) {
            currentId = id;
            const payloadIndex = fields.findIndex((field) => field === "payload");
            const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
            yield { id, payload };
          }
        }
      }
    } finally {
      await close();
    }
  })();

  return iterator;
};

const extractPlainText = (blocks: SessionMessageBlock[]) => {
  return blocks
    .flatMap((block) => {
      switch (block.type) {
        case "text":
          return [block.text];
        case "resource":
          return block.resource.text ? [block.resource.text] : [];
        case "resource_link":
          return [block.title ?? block.name ?? block.uri];
        default:
          return [];
      }
    })
    .join("\n")
    .trim();
};

const getNextBranchIndex = async (parentMessageId: string) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionMessages)
    .where(eq(sessionMessages.parentMessageId, parentMessageId));
  return row?.count ?? 0;
};

const markParentAsHavingChild = async (parentMessageId: string) => {
  const [parent] = await db
    .select({ childCount: sessionMessages.childCount })
    .from(sessionMessages)
    .where(eq(sessionMessages.id, parentMessageId))
    .limit(1);

  if (!parent) return;
  const nextCount = (parent.childCount ?? 0) + 1;
  await db
    .update(sessionMessages)
    .set({ childCount: nextCount, isLeaf: false, isBranchPoint: nextCount > 1 })
    .where(eq(sessionMessages.id, parentMessageId));
};

export const createUserMessageNode = async (input: {
  runtimeSessionId: string;
  text: string;
  images?: Array<{ url: string }>;
  branchFromMessageId?: string | null;
}) => {
  const session = await getRuntimeSessionById(input.runtimeSessionId);
  if (!session) throw new Error("Runtime session not found");

  const parentMessageId = input.branchFromMessageId ?? session.currentLeafMessageId ?? null;
  let depth = 0;
  let branchId: `${string}-${string}-${string}-${string}-${string}` = randomUUID();
  let branchIndex = 0;
  let branchCreated = false;

  if (parentMessageId) {
    const [parent] = await db
      .select({ id: sessionMessages.id, depth: sessionMessages.depth, branchId: sessionMessages.branchId })
      .from(sessionMessages)
      .where(eq(sessionMessages.id, parentMessageId))
      .limit(1);
    if (!parent) throw new Error("Parent message not found");

    depth = (parent.depth ?? 0) + 1;
    branchIndex = await getNextBranchIndex(parentMessageId);
    const isBranchingFromHistory =
      !!input.branchFromMessageId && input.branchFromMessageId !== session.currentLeafMessageId;

    if (isBranchingFromHistory) {
      branchId = randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
      branchCreated = true;
    } else {
      branchId = parent.branchId as `${string}-${string}-${string}-${string}-${string}`;
    }
  }

  const content: SessionMessageBlock[] = [
    { type: "text", text: input.text },
    ...(input.images?.map((image) => ({ type: "image" as const, uri: image.url, mimeType: undefined })) ?? []),
  ];

  const [message] = await db
    .insert(sessionMessages)
    .values({
      sessionId: input.runtimeSessionId,
      role: "user",
      source: "internal",
      externalMessageId: null,
      content,
      text: extractPlainText(content),
      meta: null,
      parentMessageId,
      depth,
      branchId,
      branchIndex,
    })
    .returning();

  if (!message) throw new Error("Failed to create user message node");
  if (parentMessageId) await markParentAsHavingChild(parentMessageId);

  await db
    .update(runtimeSessions)
    .set({
      rootMessageId: session.rootMessageId ?? message.id,
      currentLeafMessageId: message.id,
      latestMessageText: message.text,
      lastMessageAt: message.createdAt ?? new Date(),
      totalMessages: (session.totalMessages ?? 0) + 1,
      totalBranches: branchCreated ? (session.totalBranches ?? 1) + 1 : session.totalBranches,
      updatedAt: new Date(),
    })
    .where(eq(runtimeSessions.id, input.runtimeSessionId));

  return message;
};

export const persistMessageNode = async (input: PersistMessageInput) => {
  const [existing] = await db
    .select()
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.sessionId, input.sessionId),
        eq(sessionMessages.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const session = await getRuntimeSessionById(input.sessionId);
  if (!session || session.runtimeId !== input.runtimeId) {
    throw new Error("Runtime session not found");
  }

  const [parent] = await db
    .select()
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.id, input.parentMessageId),
        eq(sessionMessages.sessionId, input.sessionId),
      ),
    )
    .limit(1);
  if (!parent) throw new Error("Parent message not found");

  const branchIndex = await getNextBranchIndex(parent.id);
  const content = input.message.content;
  const text = input.message.text === undefined ? extractPlainText(content) : (input.message.text ?? null);

  let messageNode: typeof sessionMessages.$inferSelect | undefined;
  try {
    [messageNode] = await db
      .insert(sessionMessages)
      .values({
        sessionId: input.sessionId,
        role: input.message.role ?? "assistant",
        source: input.message.source ?? "internal",
        externalMessageId: input.message.externalMessageId ?? null,
        content,
        text,
        meta: input.message.meta ?? null,
        parentMessageId: parent.id,
        idempotencyKey: input.idempotencyKey,
        depth: (parent.depth ?? 0) + 1,
        branchId: parent.branchId,
        branchIndex,
        provider: input.message.provider ?? null,
        model: input.message.model ?? null,
        stopReason: input.message.stopReason ?? null,
        errorMessage: input.message.errorMessage ?? null,
        usageInput: input.message.usage?.input ?? null,
        usageOutput: input.message.usage?.output ?? null,
        usageTotalTokens: input.message.usage?.totalTokens ?? null,
        costTotal: input.message.usage?.costTotal !== undefined ? String(input.message.usage.costTotal) : null,
      })
      .returning();
  } catch {
    const [conflicted] = await db
      .select()
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.sessionId, input.sessionId),
          eq(sessionMessages.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (conflicted) return conflicted;
    throw new Error("Failed to persist message");
  }

  if (!messageNode) throw new Error("Failed to persist message");
  await markParentAsHavingChild(parent.id);

  const toolCalls = input.toolCalls ?? [];
  if (toolCalls.length > 0) {
    await db.insert(sessionToolCalls).values(
      toolCalls.map((toolCall: PersistToolCall) => ({
        sessionId: input.sessionId,
        messageId: messageNode.id,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        title: toolCall.title ?? null,
        kind: toolCall.kind ?? null,
        status: toolCall.status ?? (toolCall.isError ? "failed" : "completed"),
        args: toolCall.args ?? null,
        result: toolCall.result ?? null,
        content: toolCall.content ?? null,
        locations: toolCall.locations ?? null,
        rawInput: toolCall.rawInput ?? toolCall.args ?? null,
        rawOutput: toolCall.rawOutput ?? toolCall.result ?? null,
        resultPreview: toolCall.resultPreview ?? null,
        isError: toolCall.isError ?? false,
        meta: toolCall.meta ?? null,
      })),
    );
  }

  const allMessages = await db
    .select({ costTotal: sessionMessages.costTotal })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, input.sessionId));

  const totalCost = allMessages.reduce((sum, message) => {
    const value = Number(message.costTotal ?? 0);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  const [toolCallCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionToolCalls)
    .where(eq(sessionToolCalls.sessionId, input.sessionId));

  const [messageCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, input.sessionId));

  await db
    .update(runtimeSessions)
    .set({
      currentLeafMessageId: messageNode.id,
      latestMessageText: messageNode.text,
      lastMessageAt: messageNode.createdAt ?? new Date(),
      totalMessages: messageCountRow?.count ?? session.totalMessages,
      totalToolCalls: toolCallCountRow?.count ?? session.totalToolCalls,
      totalInputTokens: (session.totalInputTokens ?? 0) + (input.message.usage?.input ?? 0),
      totalOutputTokens: (session.totalOutputTokens ?? 0) + (input.message.usage?.output ?? 0),
      totalCost: String(totalCost),
      updatedAt: new Date(),
    })
    .where(eq(runtimeSessions.id, input.sessionId));

  // 触发 Outbound：优先分发到当前 session 已建立的 chat 绑定；
  // 只有没有任何 session binding 时，才退回 runtime 级别的 channel 配置。
  const bindings = await getBindingsBySessionId(session.id);

  if (bindings.length > 0) {
    for (const binding of bindings) {
      await touchRuntimeSessionBinding(binding.id).catch(console.error);
      dispatchOutboundMessage({
        runtimeChannelId: binding.runtimeChannelId,
        externalChatId: binding.externalChatId,
        content: messageNode.content,
        replyToExternalMessageId: messageNode.externalMessageId ?? undefined,
      }).catch(console.error);
    }
  } else {
    const channels = await db
      .select()
      .from(runtimeChannels)
      .where(eq(runtimeChannels.runtimeId, session.runtimeId));

    for (const rc of channels) {
      dispatchOutboundMessage({
        runtimeChannelId: rc.id,
        content: messageNode.content,
        replyToExternalMessageId: messageNode.externalMessageId ?? undefined,
      }).catch(console.error);
    }
  }

  return messageNode;
};

export const updateRuntimeSessionInfo = async (input: PersistSessionInfoUpdateInput) => {
  const session = await getRuntimeSessionById(input.sessionId);
  if (!session || session.runtimeId !== input.runtimeId) {
    throw new Error("Runtime session not found");
  }

  await db
    .update(runtimeSessions)
    .set({
      title: input.title === undefined ? session.title : (input.title ?? null),
      lastMessageAt: input.updatedAt === undefined ? session.lastMessageAt : input.updatedAt ? new Date(input.updatedAt) : null,
      meta:
        input.meta === undefined
          ? session.meta
          : {
              ...((session.meta as Record<string, unknown> | null) ?? {}),
              ...(input.meta ?? {}),
            },
      updatedAt: new Date(),
    })
    .where(eq(runtimeSessions.id, input.sessionId));

  return true;
};

export const listSessionTree = async (runtimeSessionId: string) => {
  return db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, runtimeSessionId))
    .orderBy(asc(sessionMessages.createdAt));
};

export const getCurrentPathMessages = async (runtimeSessionId: string) => {
  const session = await getRuntimeSessionById(runtimeSessionId);
  if (!session?.currentLeafMessageId) return [];

  const allMessages = await db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, runtimeSessionId));

  const byId = new Map(allMessages.map((message) => [message.id, message]));
  const path: typeof allMessages = [];
  let current = byId.get(session.currentLeafMessageId) ?? null;

  while (current) {
    path.unshift(current);
    current = current.parentMessageId ? (byId.get(current.parentMessageId) ?? null) : null;
  }

  return path;
};

export const listToolCallsByMessageIds = async (messageIds: string[]) => {
  if (messageIds.length === 0) return [];
  return db
    .select()
    .from(sessionToolCalls)
    .where(inArray(sessionToolCalls.messageId, messageIds))
    .orderBy(asc(sessionToolCalls.createdAt));
};

export const selectRuntimeSessionLeaf = async (input: {
  runtimeSessionId: string;
  leafMessageId: string;
}) => {
  const [message] = await db
    .select({ id: sessionMessages.id, sessionId: sessionMessages.sessionId })
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.id, input.leafMessageId),
        eq(sessionMessages.sessionId, input.runtimeSessionId),
      ),
    )
    .limit(1);

  if (!message) throw new Error("Leaf message not found");

  await db
    .update(runtimeSessions)
    .set({ currentLeafMessageId: input.leafMessageId, updatedAt: new Date() })
    .where(eq(runtimeSessions.id, input.runtimeSessionId));

  return true;
};
