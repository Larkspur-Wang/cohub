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
  redis,
} from "./redis.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";
import { bindRuntimeChannelsToGateway, dispatchOutboundMessage, getBindingBySessionId, touchRuntimeSessionBinding } from "./channels.js";
import { ensureUserGitAccount } from "./git-accounts.js";

export type SessionMessageBlock = UnifiedContentBlock;

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

export const registerRuntimeSession = async (input: RegisterRuntimeSessionInput) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) throw new Error("Runtime not found");

  const [existing] = await db
    .select()
    .from(runtimeSessions)
    .where(eq(runtimeSessions.id, input.sessionId))
    .limit(1);
  if (existing) return existing;

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
};

export const launchRuntimeSandbox = async (input: {
  runtimeId: string;
  userUuid: string;
}) => {
  const runtime = await getRuntimeById(input.runtimeId);
  if (!runtime) throw new Error("Runtime not found");

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

  await k8sCoreApi.createNamespacedPod({
    namespace: sessionsNamespace,
    body: pod,
  });

  // 拉起关联的 IM Channels
  await bindRuntimeChannelsToGateway(input.runtimeId).catch(console.error);

  return pod;
};

export const waitForRuntimeRunning = async (runtimeId: string, timeoutMs = 30000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await redis.hget(getRuntimeMetaKey(runtimeId), "status");
    if (status === "running") return true;
    if (status === "error" || status === "stopped") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
};

export const getRuntimeLiveStatus = async (runtimeId: string) => {
  const status = await redis.hget(getRuntimeMetaKey(runtimeId), "status");
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
  await redis.rpush(
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
  const client = redis.duplicate();

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

        for (const [, entries] of response) {
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

  // 触发 Outbound：只分发到当前 session 绑定的目标渠道，而不是 runtime 全量广播
  const binding = await getBindingBySessionId(session.id);

  if (binding) {
    await touchRuntimeSessionBinding(binding.id).catch(console.error);
    dispatchOutboundMessage({
      runtimeChannelId: binding.runtimeChannelId,
      externalChatId: binding.externalChatId,
      content: messageNode.content,
      replyToExternalMessageId: messageNode.externalMessageId ?? undefined,
    }).catch(console.error);
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
