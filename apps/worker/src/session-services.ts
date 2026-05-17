import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { COHUB_AGENT_TURNS_QUEUE, createBullmqQueue } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { submitSessionPrompt } from "@cohub/core/sessions";
import type { ExecutionGrantService } from "@cohub/core/security";
import type { ContentBlock } from "@cohub/protocol/core";
import { sessionTurnSegments, sessionTurns, spaceMembers, spaceSandboxes, spaceSessions, spaces } from "@cohub/db";
import { db } from "./db.js";
import { redisCommandClient } from "./redis.js";
import { config } from "./config.js";
import type { PromptTemplateService } from "./prompt-templates.js";

const AGENT_TURN_JOB_NAME = "agent_turns";
const AGENT_TURN_ABORT_CHANNEL = "pubsub:agent:turn_abort";
const getAgentTurnAbortKey = (turnId: string) => `agent:turn:${turnId}:abort`;
const getSpaceWsUsersKey = (spaceId: string) => `realtime:space:${spaceId}:ws_users`;
const getSpaceWsUsersUpdatedAtKey = (spaceId: string) => `realtime:space:${spaceId}:ws_users:updated_at`;

const agentTurnQueue = createBullmqQueue<{
  spaceId: string;
  sessionId: string;
  turnIds: string[];
  executionAuth?: { token: string; expiresAt: number } | null;
  trace?: Record<string, unknown>;
}>(COHUB_AGENT_TURNS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-agent-turns",
});

const deriveMessagePreviewText = (input: { content: ContentBlock[] }) => input.content
  .flatMap((block) => {
    switch (block.type) {
      case "text":
        return [block.text];
      case "image":
        return block.source.type === "url" ? [block.source.url] : [];
      case "shell_command":
        return [["$", block.command].join("")];
      case "system_note":
        return [block.text];
      default:
        return [];
    }
  })
  .join("\n")
  .trim();

async function ensureRootSessionTurnSegment(sessionId: string) {
  await db.insert(sessionTurnSegments).values({
    sessionId,
    ordinal: 1,
    sourceSessionId: sessionId,
    fromSequence: 1,
    toSequence: null,
  }).onConflictDoNothing({
    target: [sessionTurnSegments.sessionId, sessionTurnSegments.ordinal],
  });
}

async function registerCronjobSession(spaceId: string, options: { source: string; title?: string | null }) {
  const [space] = await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) throw new Error("space not found");

  const sessionId = randomUUID();
  const [session] = await db.insert(spaceSessions).values({
    id: sessionId,
    spaceId,
    title: options.title ?? null,
    source: options.source,
    status: "active",
    externalSessionId: null,
    meta: { createdBy: "cronjob" },
    lastMessageAt: new Date(),
    lastMessageId: null,
  }).returning();
  if (!session) throw new Error("failed to register cronjob session");
  await ensureRootSessionTurnSegment(session.id);
  return session;
}

async function createSessionTurn(input: {
  sessionId: string;
  userUuid: string;
  userContent: ContentBlock[];
  intent: "steer";
  meta: Record<string, unknown>;
}) {
  const userText = deriveMessagePreviewText({ content: input.userContent }) || null;
  const [row] = await db.transaction(async (tx) => {
    const [sessionRow] = await tx.execute(sql`select id from v2.space_sessions where id = ${input.sessionId} for update`);
    if (!sessionRow) throw new Error("session not found");
    const [seqRow] = await tx.select({ max: sql<number>`coalesce(max(${sessionTurns.sequence}), 0)::int` }).from(sessionTurns).where(eq(sessionTurns.sessionId, input.sessionId));
    const [localSegment] = await tx.select({ fromSequence: sessionTurnSegments.fromSequence }).from(sessionTurnSegments).where(and(
      eq(sessionTurnSegments.sessionId, input.sessionId),
      eq(sessionTurnSegments.sourceSessionId, input.sessionId),
      isNull(sessionTurnSegments.toSequence),
    )).orderBy(desc(sessionTurnSegments.ordinal)).limit(1);
    const sequence = seqRow?.max ? (seqRow.max + 1) : (localSegment?.fromSequence ?? 1);
    return tx.insert(sessionTurns).values({
      sessionId: input.sessionId,
      sequence,
      userUuid: input.userUuid,
      userContent: input.userContent,
      userText,
      intent: input.intent,
      status: "running",
      meta: input.meta,
      startedAt: new Date(),
    }).returning();
  });
  if (!row) throw new Error("failed to create session turn");
  return row;
}

async function failSessionTurn(input: { sessionId: string; turnId: string; errorMessage: string }) {
  const [row] = await db.update(sessionTurns).set({
    status: "failed",
    errorMessage: input.errorMessage,
    summary: { finishReason: "failed", text: input.errorMessage },
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(sessionTurns.id, input.turnId),
    eq(sessionTurns.sessionId, input.sessionId),
    inArray(sessionTurns.status, ["running", "abort_requested"]),
  )).returning();
  return row ?? null;
}

async function recomputeSpaceWsUsers(spaceId: string) {
  const [space] = await db.select({ ownerId: spaces.userUuid }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const members = await db.select({ userId: spaceMembers.userId }).from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));
  const userIds = new Set<string>();
  if (space?.ownerId) userIds.add(space.ownerId);
  for (const member of members) if (member.userId) userIds.add(member.userId);
  const values = [...userIds];
  const pipeline = redisCommandClient.pipeline();
  pipeline.del(getSpaceWsUsersKey(spaceId));
  if (values.length > 0) pipeline.sadd(getSpaceWsUsersKey(spaceId), ...values);
  pipeline.set(getSpaceWsUsersUpdatedAtKey(spaceId), String(Date.now()));
  await pipeline.exec();
}

async function requestAgentTurnAbort(input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  reason: "interrupt";
  continuedByTurnId: string;
  actorUserId?: string | null;
}) {
  const event = {
    id: randomUUID(),
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    reason: input.reason,
    continuedByTurnId: input.continuedByTurnId,
    actorUserId: input.actorUserId ?? null,
    timestamp: Date.now(),
  };
  await redisCommandClient.set(getAgentTurnAbortKey(input.turnId), JSON.stringify(event), "EX", 60 * 60);
  await redisCommandClient.publish(AGENT_TURN_ABORT_CHANNEL, JSON.stringify(event));
}

async function enqueueSpacePrompt(input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  userMessageId: string;
  content: ContentBlock[];
  meta: Record<string, unknown>;
}) {
  const [sandbox] = await db.select({ status: spaceSandboxes.status }).from(spaceSandboxes).where(eq(spaceSandboxes.spaceId, input.spaceId)).limit(1);
  if (!sandbox || sandbox.status !== "ready") throw new Error("space sandbox is not ready");

  await recomputeSpaceWsUsers(input.spaceId).catch((error) => {
    console.warn(`[RealtimeAudience] failed to refresh ws users for ${input.spaceId}:`, error);
  });

  const actorUserId = typeof input.meta.userId === "string" && input.meta.userId.trim() ? input.meta.userId.trim() : null;
  const [activeTurn] = await db.select({ id: sessionTurns.id })
    .from(sessionTurns)
    .where(and(eq(sessionTurns.sessionId, input.sessionId), inArray(sessionTurns.status, ["running", "abort_requested"])))
    .orderBy(desc(sessionTurns.sequence))
    .limit(1);

  if (activeTurn && activeTurn.id !== input.turnId) {
    await db.update(sessionTurns).set({
      status: "abort_requested",
      meta: sql`coalesce(${sessionTurns.meta}, '{}'::jsonb) || ${JSON.stringify({ abortRequestedAt: new Date().toISOString(), continuedByTurnId: input.turnId })}::jsonb`,
      updatedAt: new Date(),
    }).where(and(eq(sessionTurns.id, activeTurn.id), eq(sessionTurns.sessionId, input.sessionId), inArray(sessionTurns.status, ["running", "abort_requested"])));
    await requestAgentTurnAbort({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      turnId: activeTurn.id,
      reason: "interrupt",
      continuedByTurnId: input.turnId,
      actorUserId,
    }).catch((error) => console.warn(`[AgentTurn] failed to publish abort for turn=${activeTurn.id}:`, error));
  }

  const executionAuth = input.meta.executionAuth as { token: string; expiresAt: number } | undefined;
  await agentTurnQueue.add(AGENT_TURN_JOB_NAME, {
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    turnIds: [input.turnId],
    executionAuth,
    trace: injectTrace(),
  }, {
    jobId: `agent-turn-${input.turnId}`,
    attempts: 2,
    backoff: { type: "fixed", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });
}

export function getSessionDomainServices(input: {
  executionGrantService: ExecutionGrantService;
  promptTemplateService: PromptTemplateService;
}) {
  return {
    registerCronjobSession,
    async submitPrompt(promptInput: Parameters<typeof submitSessionPrompt>[1]) {
      return submitSessionPrompt({
        randomUUID,
        expandPromptTemplate: ({ text, userId, spaceId }) => input.promptTemplateService.expand(text, { userId, spaceId }),
        createExecutionGrant: ({ actorUserId, spaceId, sessionId, source }) => input.executionGrantService.createExecutionGrant({ actorUserId, spaceId, sessionId, source }),
        createSessionTurn,
        enqueueSpacePrompt,
        failSessionTurn,
      }, promptInput);
    },
  };
}
