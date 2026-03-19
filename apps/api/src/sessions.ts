import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { V1Pod } from "@kubernetes/client-node";
import { db } from "./db/index.js";
import { sessions } from "./db/schema.js";
import { config, sessionsNamespace } from "./config.js";
import { k8sCoreApi } from "./k8s.js";
import { getSessionInputQueueKey, getSessionMetaKey, redis } from "./redis.js";
import { renderSandboxPodTemplate } from "./sandbox-template.js";

export const createSession = async (input: {
  userUuid: string;
  worldId?: string | null;
  agentId?: string | null;
  title?: string | null;
}) => {
  const [session] = await db
    .insert(sessions)
    .values({
      userUuid: input.userUuid,
      worldId: input.worldId ?? null,
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
  }) as V1Pod;

  await k8sCoreApi.createNamespacedPod({
    namespace: sessionsNamespace,
    body: pod,
  });

  return pod;
};

export const waitForSessionRunning = async (sessionId: string, timeoutMs = 30000) => {
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
  message: {
    text: string;
    images?: Array<{ url: string }>;
  };
}) => {
  await redis.rpush(
    getSessionInputQueueKey(input.sessionId),
    JSON.stringify({
      action: "prompt",
      id: randomUUID(),
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
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return session ?? null;
};
