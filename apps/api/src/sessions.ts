import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { V1Pod } from "@kubernetes/client-node";
import { db } from "./db/index.js";
import { sessionMessages, sessions, sessionToolCalls } from "./db/schema.js";
import { config, sessionsNamespace } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import {
  getSessionInputQueueKey,
  getSessionMetaKey,
  getSessionOutputStreamKey,
  redis,
} from "./redis.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";

export type SessionMessageBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mimeType?: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      args?: unknown;
      resultPreview?: string | null;
      isError?: boolean;
    }
  | {
      type: "system_note";
      noteType: "branch_summary" | "compaction" | "info";
      text: string;
    };

export type PersistAssistantMessageInput = {
  sessionId: string;
  parentMessageId: string;
  idempotencyKey: string;
  message: {
    content: SessionMessageBlock[];
    text?: string | null;
    provider?: string | null;
    model?: string | null;
    stopReason?: string | null;
    errorMessage?: string | null;
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      costTotal?: number;
    } | null;
  };
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    resultPreview?: string | null;
    isError?: boolean;
  }>;
};


export const createSession = async (input: {
  userUuid: string;
  workspaceId?: string | null;
  agentId?: string | null;
  title?: string | null;
}) => {
  const [session] = await db
    .insert(sessions)
    .values({
      userUuid: input.userUuid,
      workspaceId: input.workspaceId ?? null,
      agentId: input.agentId ?? null,
      title: input.title ?? null,
      status: "active",
    })
    .returning();

  if (!session) {
    throw new Error("Failed to create session");
  }

  await redis.hset(getSessionMetaKey(session.id), {
    status: "creating",
    updated_at: Date.now().toString(),
  });

  return session;
};

export const launchSessionSandbox = async (input: {
  sessionId: string;
  userUuid: string;
}) => {
  const pod = renderSandboxPodTemplate({
    SESSION_ID: input.sessionId,
    USER_ID: input.userUuid,
    REDIS_URL: config.redisUrl,
    LITELLM_API_KEY: config.litellmApiKey,
    ENV: config.env,
  }) as V1Pod;

  await k8sCoreApi.createNamespacedPod({
    namespace: sessionsNamespace,
    body: pod,
  });

  return pod;
};

export const waitForSessionRunning = async (
  sessionId: string,
  timeoutMs = 30000,
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await redis.hget(getSessionMetaKey(sessionId), "status");
    if (status === "running") {
      return true;
    }
    if (status === "error" || status === "stopped") {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
};

export const enqueueSessionPrompt = async (input: {
  sessionId: string;
  userMessageId: string;
  message: {
    text: string;
    images?: Array<{ url: string }>;
  };
  branchFromMessageId?: string;
}) => {
  await redis.rpush(
    getSessionInputQueueKey(input.sessionId),
    JSON.stringify({
      action: "prompt",
      id: randomUUID(),
      userMessageId: input.userMessageId,
      branchFromMessageId: input.branchFromMessageId ?? null,
      message: input.message,
      timestamp: new Date().toISOString(),
    }),
  );
};

export const abortSession = async (sessionId: string) => {
  await redis.rpush(
    getSessionInputQueueKey(sessionId),
    JSON.stringify({
      action: "abort",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    }),
  );
};

export const getSessionById = async (sessionId: string) => {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return session ?? null;
};

export const readSessionOutputStream = async (input: {
  sessionId: string;
  lastEventId?: string;
  blockMs?: number;
  signal?: AbortSignal;
}) => {
  const streamKey = getSessionOutputStreamKey(input.sessionId);
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

        if (!response) {
          continue;
        }

        for (const [, entries] of response) {
          for (const [id, fields] of entries) {
            currentId = id;
            const payloadIndex = fields.findIndex(
              (field) => field === "payload",
            );
            const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;

            yield {
              id,
              payload,
            };
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
    .filter((block) => block.type === "text")
    .map((block) => block.text)
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
    .set({
      childCount: nextCount,
      isLeaf: false,
      isBranchPoint: nextCount > 1,
    })
    .where(eq(sessionMessages.id, parentMessageId));
};

export const createUserMessageNode = async (input: {
  sessionId: string;
  text: string;
  images?: Array<{ url: string }>;
  branchFromMessageId?: string | null;
}) => {
  const session = await getSessionById(input.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const parentMessageId =
    input.branchFromMessageId ?? session.currentLeafMessageId ?? null;

  let depth = 0;
  let branchId: `${string}-${string}-${string}-${string}-${string}` =
    randomUUID();
  let branchIndex = 0;
  let branchCreated = false;

  if (parentMessageId) {
    const [parent] = await db
      .select({
        id: sessionMessages.id,
        depth: sessionMessages.depth,
        branchId: sessionMessages.branchId,
      })
      .from(sessionMessages)
      .where(eq(sessionMessages.id, parentMessageId))
      .limit(1);

    if (!parent) {
      throw new Error("Parent message not found");
    }

    depth = (parent.depth ?? 0) + 1;
    branchIndex = await getNextBranchIndex(parentMessageId);

    const isBranchingFromHistory =
      !!input.branchFromMessageId &&
      input.branchFromMessageId !== session.currentLeafMessageId;

    if (isBranchingFromHistory) {
      branchId = randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
      branchCreated = true;
    } else {
      branchId = parent.branchId as `${string}-${string}-${string}-${string}-${string}`;
    }
  }

  const content: SessionMessageBlock[] = [
    { type: "text", text: input.text },
    ...(input.images?.map((image) => ({
      type: "image" as const,
      url: image.url,
    })) ?? []),
  ];

  const [message] = await db
    .insert(sessionMessages)
    .values({
      sessionId: input.sessionId,
      role: "user",
      content,
      text: extractPlainText(content),
      parentMessageId,
      depth,
      branchId,
      branchIndex,
    })
    .returning();

  if (!message) {
    throw new Error("Failed to create user message node");
  }

  if (parentMessageId) {
    await markParentAsHavingChild(parentMessageId);
  }

  await db
    .update(sessions)
    .set({
      rootMessageId: session.rootMessageId ?? message.id,
      currentLeafMessageId: message.id,
      latestMessageText: message.text,
      lastMessageAt: message.createdAt ?? new Date(),
      totalMessages: (session.totalMessages ?? 0) + 1,
      totalBranches: branchCreated
        ? (session.totalBranches ?? 1) + 1
        : session.totalBranches,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, input.sessionId));

  return message;
};

export const persistAssistantMessageNode = async (
  input: PersistAssistantMessageInput,
) => {
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

  if (existing) {
    return existing;
  }

  const session = await getSessionById(input.sessionId);
  if (!session) {
    throw new Error("Session not found");
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

  if (!parent) {
    throw new Error("Parent message not found");
  }

  const branchIndex = await getNextBranchIndex(parent.id);
  const content = input.message.content;
  const text =
    input.message.text === undefined
      ? extractPlainText(content)
      : (input.message.text ?? null);

  let assistantMessage: typeof sessionMessages.$inferSelect | undefined;

  try {
    [assistantMessage] = await db
      .insert(sessionMessages)
      .values({
        sessionId: input.sessionId,
        role: "assistant",
        content,
        text,
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
        costTotal:
          input.message.usage?.costTotal !== undefined
            ? String(input.message.usage.costTotal)
            : null,
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

    if (conflicted) {
      return conflicted;
    }

    throw new Error("Failed to persist assistant message");
  }

  if (!assistantMessage) {
    throw new Error("Failed to persist assistant message");
  }

  await markParentAsHavingChild(parent.id);

  const toolCalls = input.toolCalls ?? [];
  if (toolCalls.length > 0) {
    await db.insert(sessionToolCalls).values(
      toolCalls.map((toolCall) => ({
        sessionId: input.sessionId,
        messageId: assistantMessage.id,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args ?? null,
        result: toolCall.result ?? null,
        resultPreview: toolCall.resultPreview ?? null,
        isError: toolCall.isError ?? false,
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
    .update(sessions)
    .set({
      currentLeafMessageId: assistantMessage.id,
      latestMessageText: assistantMessage.text,
      lastMessageAt: assistantMessage.createdAt ?? new Date(),
      totalMessages: messageCountRow?.count ?? session.totalMessages,
      totalToolCalls: toolCallCountRow?.count ?? session.totalToolCalls,
      totalInputTokens:
        (session.totalInputTokens ?? 0) + (input.message.usage?.input ?? 0),
      totalOutputTokens:
        (session.totalOutputTokens ?? 0) + (input.message.usage?.output ?? 0),
      totalCost: String(totalCost),
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, input.sessionId));

  return assistantMessage;
};

export const listSessionTree = async (sessionId: string) => {
  return db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(asc(sessionMessages.createdAt));
};

export const getCurrentPathMessages = async (sessionId: string) => {
  const session = await getSessionById(sessionId);
  if (!session?.currentLeafMessageId) {
    return [];
  }

  const allMessages = await db
    .select()
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId));

  const byId = new Map(allMessages.map((message) => [message.id, message]));
  const path: typeof allMessages = [];
  let current = byId.get(session.currentLeafMessageId) ?? null;

  while (current) {
    path.unshift(current);
    current = current.parentMessageId
      ? (byId.get(current.parentMessageId) ?? null)
      : null;
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

export const selectSessionLeaf = async (input: {
  sessionId: string;
  leafMessageId: string;
}) => {
  const [message] = await db
    .select({ id: sessionMessages.id, sessionId: sessionMessages.sessionId })
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.id, input.leafMessageId),
        eq(sessionMessages.sessionId, input.sessionId),
      ),
    )
    .limit(1);

  if (!message) {
    throw new Error("Leaf message not found");
  }

  await db
    .update(sessions)
    .set({
      currentLeafMessageId: input.leafMessageId,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, input.sessionId));

  return true;
};
