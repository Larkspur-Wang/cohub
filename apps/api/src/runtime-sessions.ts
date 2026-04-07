import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql, lt, desc } from "drizzle-orm";
import type { V1Pod } from "@kubernetes/client-node";
import type {
  PersistMessageInput,
  UpdateSessionInfoInput,
  RegisterSessionInput,
  ContentBlock,
  GatewayOutboundCommand,
} from "@cohub/protocol";
import { db } from "./db/index.js";
import {
  runtimeSessions,
  runtimes,
  sessionMessages,
  runtimeChannels,
  workspaces,
  providerMessageRefs,
} from "./db/schema.js";
import { config, sessionsNamespace } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import {
  getRuntimeInputQueueKey,
  getRuntimeOutputStreamKey,
  getRuntimeProvisionMetaKey,
  getRuntimeProvisionStreamKey,
  redisCommandClient,
  createStreamingRedisClient,
} from "./redis.js";
import type { RedisStreamEntry } from "./redis.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";
import { bindRuntimeChannelsToGateway, createProviderMessageRef, dispatchOutboundMessage, getBindingsBySessionId, touchRuntimeSessionBinding, getRuntimeChannelRecord } from "./channels.js";
import { ensureUserGitAccount } from "./git-accounts.js";



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
  "PUBLIC_URL_PREFIX",
  "RUNTIME_VERSION",
  "INTERNAL_API_BASE_URL",
]);

const nowIso = () => new Date().toISOString();

// ─── Content extraction helpers ───

const extractPlainText = (blocks: ContentBlock[]): string => {
  return blocks
    .flatMap((block) => {
      switch (block.type) {
        case "text":
          return [block.text];
        case "thinking":
          return [block.thinking];
        case "image":
          return block.source.type === "url" ? [block.source.url] : [];
        case "tool_use":
          return [`${block.name}(...)`];
        case "tool_result":
          return typeof block.content === "string" ? [block.content] : [];
        case "system_note":
          return [block.text];
        default:
          return [];
      }
    })
    .join("\n")
    .trim();
};

const countToolCallsInContent = (blocks: ContentBlock[]): number => {
  return blocks.filter((b) => b.type === "tool_use").length;
};

// ─── External message resolution via providerMessageRefs ───

const findLatestOutboundRefForSessionMessage = async (input: {
  provider: string;
  externalConversationId: string;
  sessionMessageId?: string | null;
}) => {
  if (!input.sessionMessageId) return null;

  const [ref] = await db
    .select()
    .from(providerMessageRefs)
    .where(
      and(
        eq(providerMessageRefs.provider, input.provider),
        eq(providerMessageRefs.externalConversationId, input.externalConversationId),
        eq(providerMessageRefs.sessionMessageId, input.sessionMessageId),
        eq(providerMessageRefs.direction, "outbound"),
      ),
    )
    .orderBy(sql`${providerMessageRefs.createdAt} desc`)
    .limit(1);

  return ref ?? null;
};

const resolveAnchorUserMessage = async (input: {
  sessionId: string;
  messageId?: string | null;
}): Promise<{ id: string } | null> => {
  let msgId = input.messageId?.trim();
  if (!msgId) return null;

  const MAX_DEPTH = 200;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const [msgWithSeq] = await db
      .select({ id: sessionMessages.id, role: sessionMessages.role, sequence: sessionMessages.sequence })
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.id, msgId),
          eq(sessionMessages.sessionId, input.sessionId),
        ),
      )
      .limit(1);

    if (!msgWithSeq) return null;
    if (msgWithSeq.role === "user") return { id: msgWithSeq.id };

    const [prev] = await db
      .select({ id: sessionMessages.id, role: sessionMessages.role })
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.sessionId, input.sessionId),
          lt(sessionMessages.sequence, msgWithSeq.sequence),
        ),
      )
      .orderBy(desc(sessionMessages.sequence))
      .limit(1);

    if (!prev) return null;
    if (prev.role === "user") return prev;
    msgId = prev.id;
  }

  console.warn(`[resolveAnchorUserMessage] Exceeded max depth (${MAX_DEPTH}) for session ${input.sessionId}`);
  return null;
};

const resolveAnchorExternalMessageId = async (input: {
  sessionId: string;
  messageId?: string | null;
  provider: string;
  externalConversationId: string;
}): Promise<string | null> => {
  const anchorMsg = await resolveAnchorUserMessage({
    sessionId: input.sessionId,
    messageId: input.messageId,
  });
  if (!anchorMsg) return null;

  // Find the inbound providerMessageRef for this anchor user message
  const [ref] = await db
    .select()
    .from(providerMessageRefs)
    .where(
      and(
        eq(providerMessageRefs.provider, input.provider),
        eq(providerMessageRefs.externalConversationId, input.externalConversationId),
        eq(providerMessageRefs.sessionMessageId, anchorMsg.id),
        eq(providerMessageRefs.direction, "inbound"),
      ),
    )
    .orderBy(sql`${providerMessageRefs.createdAt} desc`)
    .limit(1);

  return ref?.externalMessageId ?? null;
};

// ─── Env helpers ───

const getSessionExtraEnv = (runtimeMeta: unknown): RuntimeEnvVar[] => {
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
  const publicUrlPrefix = input.env === "prod"
    ? `https://public.cohub.run/r/${input.runtimeId}`
    : `https://public.cohub.run/dev/r/${input.runtimeId}`;
  const runtimeVersion = config.sandboxRuntimeImage.includes(":")
    ? config.sandboxRuntimeImage.split(":").pop() ?? config.sandboxRuntimeImage
    : config.sandboxRuntimeImage;

  return [
    { name: "RUNTIME_ID", value: input.runtimeId },
    { name: "REDIS_URL", value: input.redisUrl },
    { name: "ENV", value: input.env ?? "" },
    { name: "WORKSPACE_DIR", value: "/workspace" },
    { name: "SESSIONS_DIR", value: "/sessions" },
    { name: "PUBLIC_URL_PREFIX", value: publicUrlPrefix },
    { name: "RUNTIME_VERSION", value: runtimeVersion },
    { name: "LITELLM_API_KEY", value: input.litellmApiKey ?? "" },
    { name: "WORKSPACE_REPO_URL", value: input.workspaceRepoUrl ?? "" },
    { name: "WORKSPACE_GIT_USERNAME", value: input.workspaceGitUsername ?? "" },
    { name: "WORKSPACE_GIT_EMAIL", value: input.workspaceGitEmail ?? "" },
    { name: "INTERNAL_API_BASE_URL", value: input.env === "prod"
      ? "http://cohub-api.cohub.svc.cluster.local:8787"
      : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787" },
    ...(input.extraEnv ?? []),
  ];
};

// ─── Provision helpers ───

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

export const updateRuntimeStatus = async (runtimeId: string, status: string) => {
  await db
    .update(runtimes)
    .set({ status, updatedAt: new Date() })
    .where(eq(runtimes.id, runtimeId));
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

// ─── Runtime CRUD ───

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
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.name)) {
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

export const createRuntime = async (input: {
  userUuid: string;
  workspaceId?: string | null;
  agentId?: string | null;
  title?: string | null;
  cwd?: string | null;
  protocol?: "pi" | "acp" | "internal" | null;
  meta?: Record<string, unknown> | null;
  start?: boolean;
}) => {
  const shouldStart = input.start ?? false;
  const [runtime] = await db
    .insert(runtimes)
    .values({
      userUuid: input.userUuid,
      workspaceId: input.workspaceId ?? null,
      agentId: input.agentId ?? null,
      title: input.title ?? null,
      status: shouldStart ? "starting" : "hibernated",
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

export const createInitialRuntimeSession = async (input: RegisterSessionInput) => {
  const [session] = await db
    .insert(runtimeSessions)
    .values({
      id: input.sessionId,
      runtimeId: input.runtimeId,
      title: input.title ?? null,
      source: input.source ?? null,
      status: "active",
      cwd: input.cwd ?? null,
      protocol: input.protocol ?? "pi",
      externalSessionId: input.externalSessionId ?? null,
      meta: input.meta ?? null,
      parentSessionId: null,
      forkedFromMessageId: null,
      lineageRootSessionId: input.sessionId,
      forkDepth: 0,
      lastMessageId: null,
    })
    .returning();

  if (!session) throw new Error("Failed to create initial runtime session");
  return session;
};

export const registerRuntimeSession = async (input: RegisterSessionInput) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) throw new Error("Runtime not found");

  try {
    const [session] = await db
      .insert(runtimeSessions)
      .values({
        id: input.sessionId,
        runtimeId: input.runtimeId,
        title: input.title ?? null,
        source: input.source ?? null,
        status: "active",
        cwd: input.cwd ?? null,
        protocol: input.protocol ?? "pi",
        externalSessionId: input.externalSessionId ?? null,
        meta: input.meta ?? null,
        parentSessionId: null,
        forkedFromMessageId: null,
        lineageRootSessionId: input.sessionId,
        forkDepth: 0,
        lastMessageId: null,
      })
      .returning();

    if (!session) throw new Error("Failed to register runtime session");
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
        return existing;
      }
    }

    throw error;
  }
};

export const listRuntimeSessions = async (runtimeId: string) => {
  return db
    .select()
    .from(runtimeSessions)
    .where(eq(runtimeSessions.runtimeId, runtimeId))
    .orderBy(asc(runtimeSessions.createdAt));
};

export const getRuntimeSessionBootstrap = async (runtimeSessionId: string) => {
  const session = await getRuntimeSessionById(runtimeSessionId);
  if (!session) return null;

  const forkSourceMessageId = session.forkedFromMessageId;

  return {
    session,
    forkSourceProtocolMessageId: forkSourceMessageId,
  };
};

// ─── Session message helpers ───

const getNextSessionSequence = async (sessionId: string) => {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${sessionMessages.sequence}), 0)::int` })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId));
  return (row?.max ?? 0) + 1;
};

const updateSessionAfterAppend = async (sessionId: string, message: typeof sessionMessages.$inferSelect) => {
  await db
    .update(runtimeSessions)
    .set({
      lastMessageId: message.id,
      latestMessageText: message.text,
      lastMessageAt: message.createdAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(runtimeSessions.id, sessionId));
};

export const createUserMessageNode = async (input: {
  runtimeSessionId: string;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
}) => {
  const session = await getRuntimeSessionById(input.runtimeSessionId);
  if (!session) throw new Error("Runtime session not found");

  const content = input.content;
  if (content.length === 0) throw new Error("User message content cannot be empty");

  const sequence = await getNextSessionSequence(input.runtimeSessionId);

  const [message] = await db
    .insert(sessionMessages)
    .values({
      sessionId: input.runtimeSessionId,
      role: "user",
      content,
      text: extractPlainText(content),
      meta: {
        ...(input.meta ?? {}),
        messageKind: "user",
      },
      sequence,
    })
    .returning();

  if (!message) throw new Error("Failed to create user message node");

  // Auto-fill session title from first user message
  if (!session.title?.trim()) {
    const titleText = extractPlainText(content)
      .replace(/\s+/g, " ")
      .replace(/^[:\-\s]+/, "")
      .trim()
      .slice(0, 60);

    if (titleText) {
      await db
        .update(runtimeSessions)
        .set({ title: titleText, updatedAt: new Date() })
        .where(eq(runtimeSessions.id, input.runtimeSessionId));
    }
  }

  await updateSessionAfterAppend(input.runtimeSessionId, message);
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

  if (input.previousMessageId) {
    const [previous] = await db
      .select()
      .from(sessionMessages)
      .where(
        and(
          eq(sessionMessages.id, input.previousMessageId),
          eq(sessionMessages.sessionId, input.sessionId),
        ),
      )
      .limit(1);
    if (!previous) throw new Error("Previous message not found");
  }

  const sequence = await getNextSessionSequence(input.sessionId);
  const content = input.message.content;
  const text = input.message.text === undefined ? extractPlainText(content) : (input.message.text ?? null);
  const messageRole = input.message.role ?? "assistant";
  const shouldDispatchToProvider = messageRole === "assistant";

  if (messageRole === "assistant" && content.length === 0 && !text?.trim()) {
    throw new Error("Refusing to persist empty assistant message");
  }

  let anchorUserMessageId = input.anchorUserMessageId?.trim() || null;
  if (!anchorUserMessageId) {
    const fallbackAnchor = await resolveAnchorUserMessage({
      sessionId: input.sessionId,
      messageId: input.previousMessageId ?? session.lastMessageId ?? null,
    });
    anchorUserMessageId = fallbackAnchor?.id ?? null;
  }

  const toolUseCount = countToolCallsInContent(content);
  const hasError = input.message.errorMessage || input.message.stopReason === "error" || input.message.stopReason === "aborted";

  const messageKind = (() => {
    if (messageRole !== "assistant") return messageRole;
    if (hasError) return "assistant_error";
    if (toolUseCount > 0 || input.message.stopReason === "tool_use") return "assistant_intermediate";
    return "assistant_final";
  })();

  let messageNode: typeof sessionMessages.$inferSelect | undefined;
  try {
    [messageNode] = await db
      .insert(sessionMessages)
      .values({
        sessionId: input.sessionId,
        role: messageRole,
        content,
        text,
        meta: {
          ...((input.message.meta as Record<string, unknown> | null) ?? {}),
          messageKind,
          anchorUserMessageId,
          providerResponseId:
            ((input.message.meta as Record<string, unknown> | null)?.responseId as string | undefined) ?? null,
        },
        idempotencyKey: input.idempotencyKey,
        sequence,
        provider: input.message.provider ?? null,
        model: input.message.model ?? null,
        stopReason: input.message.stopReason ?? null,
        errorMessage: input.message.errorMessage ?? null,
        usageInput: input.message.usage?.input ?? null,
        usageOutput: input.message.usage?.output ?? null,
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

  await updateSessionAfterAppend(input.sessionId, messageNode);

  if (!shouldDispatchToProvider) {
    console.log(
      `[RuntimeSessions] Skip outbound dispatch for non-assistant message ${messageNode.id} role=${messageRole}`,
    );
    return messageNode;
  }

  // Dispatch to providers — resolve reply-to via providerMessageRefs
  const bindings = await getBindingsBySessionId(session.id);

  if (bindings.length > 0) {
    for (const binding of bindings) {
      const replyToExternalMsgId = await resolveAnchorExternalMessageId({
        sessionId: input.sessionId,
        messageId: anchorUserMessageId,
        provider: binding.provider,
        externalConversationId: binding.externalChatId,
      });

      const existingTurnRef = anchorUserMessageId
        ? await findLatestOutboundRefForSessionMessage({
            provider: binding.provider,
            externalConversationId: binding.externalChatId,
            sessionMessageId: anchorUserMessageId,
          })
        : null;

      await touchRuntimeSessionBinding(binding.id).catch(console.error);
      await dispatchOutboundMessage({
        runtimeChannelId: binding.runtimeChannelId,
        runtimeId: session.runtimeId,
        runtimeSessionId: session.id,
        sessionMessageId: messageNode.id,
        provider: binding.provider,
        externalChatId: binding.externalChatId,
        content: messageNode.content,
        replyToExternalMessageId: replyToExternalMsgId ?? undefined,
        meta: {
          bindingKey: binding.bindingKey,
          sessionMessageRole: messageNode.role,
          editExternalMessageId: existingTurnRef?.externalMessageId ?? null,
          turnAnchorMessageId: anchorUserMessageId ?? messageNode.id,
        },
      }).catch(console.error);
    }
  } else {
    const channels = await db
      .select()
      .from(runtimeChannels)
      .where(eq(runtimeChannels.runtimeId, session.runtimeId));

    for (const rc of channels) {
      await dispatchOutboundMessage({
        runtimeChannelId: rc.id,
        runtimeId: session.runtimeId,
        runtimeSessionId: session.id,
        sessionMessageId: messageNode.id,
        content: messageNode.content,
        replyToExternalMessageId: undefined,
        meta: {
          sessionMessageRole: messageNode.role,
        },
      }).catch(console.error);
    }
  }

  return messageNode;
};

export const updateRuntimeSessionInfo = async (input: UpdateSessionInfoInput) => {
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

export const listSessionMessages = async (runtimeSessionId: string) => {
  return db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, runtimeSessionId))
    .orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));
};

export const forkRuntimeSession = async (input: {
  runtimeId: string;
  parentSessionId: string;
  fromMessageId: string;
  newSessionId?: string;
  title?: string | null;
}) => {
  const parentSession = await getRuntimeSessionById(input.parentSessionId);
  if (!parentSession || parentSession.runtimeId !== input.runtimeId) {
    throw new Error("Parent runtime session not found");
  }

  const [fromMessage] = await db
    .select()
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.id, input.fromMessageId),
        eq(sessionMessages.sessionId, input.parentSessionId),
      ),
    )
    .limit(1);

  if (!fromMessage) {
    throw new Error("Fork source message not found");
  }

  const newSessionId = input.newSessionId ?? randomUUID();
  const lineageRootSessionId = parentSession.lineageRootSessionId ?? parentSession.id;

  const [childSession] = await db
    .insert(runtimeSessions)
    .values({
      id: newSessionId,
      runtimeId: input.runtimeId,
      title: input.title ?? parentSession.title ?? null,
      status: "active",
      cwd: parentSession.cwd,
      protocol: parentSession.protocol,
      externalSessionId: null,
      meta: {
        forked: true,
        fromSessionId: parentSession.id,
        fromMessageId: fromMessage.id,
      },
      parentSessionId: parentSession.id,
      forkedFromMessageId: fromMessage.id,
      lineageRootSessionId,
      forkDepth: (parentSession.forkDepth ?? 0) + 1,
      lastMessageId: null,
    })
    .returning();

  if (!childSession) throw new Error("Failed to create forked session");

  const sourceMessages = await db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, parentSession.id))
    .orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));

  const messagesToCopy = sourceMessages.filter((message) => message.sequence <= fromMessage.sequence);
  const copiedIdMap = new Map<string, string>();

  for (const message of messagesToCopy) {
    const [copiedMessage] = await db
      .insert(sessionMessages)
      .values({
        sessionId: childSession.id,
        role: message.role,
        content: message.content,
        text: message.text,
        meta: message.meta,
        idempotencyKey: null,
        sequence: message.sequence,
        provider: message.provider,
        model: message.model,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
        usageInput: message.usageInput,
        usageOutput: message.usageOutput,
        costTotal: message.costTotal,
      })
      .returning();

    if (!copiedMessage) throw new Error("Failed to copy forked message");
    copiedIdMap.set(message.id, copiedMessage.id);
  }

  const copiedMessages = await listSessionMessages(childSession.id);
  const lastMessage = copiedMessages.at(-1) ?? null;

  await db
    .update(runtimeSessions)
    .set({
      lastMessageId: lastMessage?.id ?? null,
      latestMessageText: lastMessage?.text ?? null,
      lastMessageAt: lastMessage?.createdAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(runtimeSessions.id, childSession.id));

  return (await getRuntimeSessionById(childSession.id)) ?? childSession;
};

// ─── Prompt enqueue / stream ───

export const enqueueRuntimePrompt = async (input: {
  runtimeId: string;
  sessionId: string;
  userMessageId?: string | null;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
}) => {
  console.log("[RuntimeSessions] enqueueRuntimePrompt", {
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    userMessageId: input.userMessageId ?? null,
    contentLength: input.content.length,
    meta: input.meta ?? null,
  });

  await redisCommandClient.rpush(
    getRuntimeInputQueueKey(input.runtimeId),
    JSON.stringify({
      action: "prompt",
      id: randomUUID(),
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
      userMessageId: input.userMessageId ?? null,
      content: input.content,
      meta: input.meta ?? null,
      timestamp: new Date().toISOString(),
    }),
  );
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

// ─── Runtime lifecycle ───

export const waitForRuntimeRunning = async (runtimeId: string, timeoutMs = 30000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const runtime = await getRuntimeById(runtimeId);
    if (!runtime) return false;
    if (runtime.status === "running") return true;
    if (runtime.status === "error" || runtime.status === "stopped") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
};

export const launchRuntimeSandbox = async (input: {
  runtimeId: string;
  userUuid: string;
}) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) throw new Error("Runtime not found");

  const extraEnv = getSessionExtraEnv(runtime.meta);
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

    const extraEnv = getSessionExtraEnv(runtime.meta);
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

    const ready = await waitForRuntimeRunning(runtimeId, 60000);
    if (!ready) {
      const runtime = await getRuntimeById(runtimeId);
      const dbStatus = runtime?.status ?? "unknown";
      logProvision(runtimeId, "wait_runtime_running", "error", {
        dbStatus,
      });
      await pushProvisionEvent(runtimeId, {
        status: "failed",
        step: "wait_runtime_running",
        level: "error",
        message: "Runtime did not reach running state within timeout.",
        error: `timeout waiting for runtime status (current: ${dbStatus})`,
        meta: { dbStatus },
        markFinished: true,
        syncRuntimeStatus: true,
      });
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

export const hibernateRuntime = async (input: { runtimeId: string; userUuid: string }) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) {
    throw new Error("Runtime not found");
  }
  if (runtime.userUuid !== input.userUuid) {
    throw new Error("Unauthorized");
  }

  if (runtime.status !== "running") {
    throw new Error(`Can only hibernate running runtime, current status: ${runtime.status}`);
  }

  try {
    await k8sCoreApi.deleteNamespacedPod({
      name: `runtime-${runtime.id}`,
      namespace: sessionsNamespace,
    });
  } catch {
    // Pod may already be gone
  }

  await db
    .update(runtimes)
    .set({ status: "hibernated", updatedAt: new Date() })
    .where(eq(runtimes.id, runtime.id));

  return { runtime: { ...runtime, status: "hibernated" } };
};

export const wakeRuntime = async (input: { runtimeId: string; userUuid: string }) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) {
    throw new Error("Runtime not found");
  }
  if (runtime.userUuid !== input.userUuid) {
    throw new Error("Unauthorized");
  }

  if (runtime.status !== "hibernated") {
    throw new Error(`Can only wake hibernated runtime, current status: ${runtime.status}`);
  }

  await db
    .update(runtimes)
    .set({ status: "starting", updatedAt: new Date() })
    .where(eq(runtimes.id, runtime.id));

  void provisionRuntimeInBackground({ runtimeId: runtime.id, userUuid: input.userUuid }).catch(console.error);

  return { runtime: { ...runtime, status: "starting" } };
};

export const deleteRuntime = async (input: { runtimeId: string; userUuid: string }) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) {
    throw new Error("Runtime not found");
  }
  if (runtime.userUuid !== input.userUuid) {
    throw new Error("Unauthorized");
  }

  const deletableStatuses = ["hibernated", "boot_failed", "error"];
  if (!deletableStatuses.includes(runtime.status ?? "")) {
    throw new Error(`Can only delete hibernated, boot_failed or error runtime, current status: ${runtime.status}`);
  }

  try {
    await k8sCoreApi.deleteNamespacedPod({
      name: `runtime-${runtime.id}`,
      namespace: sessionsNamespace,
    });
  } catch {
    // Pod may already be gone
  }

  // Clean up channel routing cache
  const channels = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.runtimeId, input.runtimeId));
  for (const ch of channels) {
    if (ch.id) {
      await redisCommandClient.hdel("gateway:channel_routing", ch.id).catch(console.error);
      await redisCommandClient.hdel("gateway:node:*:channels", ch.id).catch(console.error);
    }
  }
  await db.delete(runtimeChannels).where(eq(runtimeChannels.runtimeId, input.runtimeId));

  // Clean up Redis keys
  const keysToDelete = [
    getRuntimeInputQueueKey(input.runtimeId),
    getRuntimeOutputStreamKey(input.runtimeId),
    getRuntimeProvisionMetaKey(input.runtimeId),
    getRuntimeProvisionStreamKey(input.runtimeId),
  ].filter((k): k is string => k !== null && k !== undefined);
  if (keysToDelete.length > 0) {
    await redisCommandClient.del(...keysToDelete).catch(console.error);
  }

  await db
    .update(runtimes)
    .set({
      status: "deleted",
      meta: { ...(runtime.meta as Record<string, unknown> | null), deletedAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, runtime.id));

  return { success: true };
};
