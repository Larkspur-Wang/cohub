import { billingOperations, COHUB_BILLING_TOKEN_TYPES, COHUB_BILLING_USAGE_TYPES } from "@cohub/billing";
import { referrals, sessionMessages, sessionTurns, spaceSessions, tokenUsageStatsHourly } from "@cohub/db";
import {
  SESSION_MESSAGE_POSTPROCESS_JOB,
  type SessionMessagePostprocessJobData,
  type Usage,
} from "@cohub/protocol";
import type { Job } from "bullmq";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../../db.js";
import { registerSystemJob } from "../../registry.js";

const finiteNumberOrZero = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeUsage = (value: unknown): Usage | null =>
  value && typeof value === "object" ? (value as Usage) : null;

const resolveActorUserId = async (message: typeof sessionMessages.$inferSelect) => {
  const meta = message.meta as Record<string, unknown> | null;
  if (typeof meta?.actorUserId === "string" && meta.actorUserId.trim()) return meta.actorUserId.trim();
  const anchorUserMessageId = typeof meta?.anchorUserMessageId === "string" ? meta.anchorUserMessageId : null;
  if (!anchorUserMessageId) return null;
  const [anchor] = await db
    .select({ meta: sessionMessages.meta })
    .from(sessionMessages)
    .where(and(eq(sessionMessages.id, anchorUserMessageId), eq(sessionMessages.sessionId, message.sessionId)))
    .limit(1);
  const userId = (anchor?.meta as Record<string, unknown> | null)?.userId;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
};

const recordBilling = async (message: typeof sessionMessages.$inferSelect, userId: string | null, usage: Usage | null) => {
  if (!userId || message.errorMessage || message.stopReason === "error" || message.stopReason === "aborted") return;
  const amount = usage?.cost?.total;
  const amountUsd = typeof amount === "number" && Number.isFinite(amount) && amount > 0
    ? Number(amount.toFixed(8))
    : 0;
  if (amountUsd <= 0 || !billingOperations.status.configured) return;
  await billingOperations.recordUsage({
    userId,
    amountUsd,
    tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
    usageType: COHUB_BILLING_USAGE_TYPES.generationLlm,
    sourceId: message.id,
    operationId: `llm:${message.id}`,
    reason: `LLM usage ${message.provider ?? "unknown"}/${message.model ?? "unknown"}`,
  });
};

const grantReferralSide = async (input: {
  referralId: string;
  userId: string;
  side: "inviter" | "invitee";
  expectedAmountUsd: number;
}) => billingOperations.grantReferralReward({
  userId: input.userId,
  referralId: input.referralId,
  side: input.side,
  expectedAmountUsd: input.expectedAmountUsd,
  operationId: `referral:${input.referralId}:${input.side}`,
});

const qualifyAndRewardReferral = async (message: typeof sessionMessages.$inferSelect) => {
  const meta = message.meta as Record<string, unknown> | null;
  const turnId = typeof meta?.turnId === "string" ? meta.turnId : null;
  if (!turnId || meta?.messageKind !== "assistant_final") return;
  const [turn] = await db
    .select({ userUuid: sessionTurns.userUuid, status: sessionTurns.status })
    .from(sessionTurns)
    .where(and(eq(sessionTurns.id, turnId), eq(sessionTurns.sessionId, message.sessionId)))
    .limit(1);
  if (!turn?.userUuid || turn.status !== "completed") return;

  const now = new Date();
  await db
    .update(referrals)
    .set({ status: "qualified", qualifiedAt: now, updatedAt: now })
    .where(and(eq(referrals.inviteeUserId, turn.userUuid), eq(referrals.status, "pending")));

  const [referral] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.inviteeUserId, turn.userUuid))
    .limit(1);
  if (!referral || referral.status === "rewarded") return;

  const errors: string[] = [];
  if (!referral.inviteeRewardedAt) {
    try {
      const result = await grantReferralSide({
        referralId: referral.id,
        userId: referral.inviteeUserId,
        side: "invitee",
        expectedAmountUsd: Number(referral.inviteeRewardAmountUsd),
      });
      await db.update(referrals).set({
        inviteeRewardedAt: now,
        inviteeRewardAmountUsd: String(result.amountUsd),
        rewardAttemptedAt: now,
        updatedAt: now,
      }).where(and(eq(referrals.id, referral.id), isNull(referrals.inviteeRewardedAt)));
    } catch (error) {
      errors.push(`invitee: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [afterInvitee] = await db.select().from(referrals).where(eq(referrals.id, referral.id)).limit(1);
  if (afterInvitee && !afterInvitee.inviterRewardedAt) {
    try {
      const result = await grantReferralSide({
        referralId: afterInvitee.id,
        userId: afterInvitee.inviterUserId,
        side: "inviter",
        expectedAmountUsd: Number(afterInvitee.inviterRewardAmountUsd),
      });
      await db.update(referrals).set({
        inviterRewardedAt: now,
        inviterRewardAmountUsd: String(result.amountUsd),
        rewardAttemptedAt: now,
        updatedAt: now,
      }).where(and(eq(referrals.id, afterInvitee.id), isNull(referrals.inviterRewardedAt)));
    } catch (error) {
      errors.push(`inviter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [latest] = await db.select().from(referrals).where(eq(referrals.id, referral.id)).limit(1);
  if (latest?.inviteeRewardedAt && latest.inviterRewardedAt) {
    await db.update(referrals).set({
      status: "rewarded",
      rewardedAt: latest.rewardedAt ?? now,
      rewardError: null,
      rewardAttemptedAt: now,
      updatedAt: now,
    }).where(and(eq(referrals.id, latest.id), eq(referrals.status, "qualified")));
  } else {
    await db.update(referrals).set({
      rewardError: errors.length > 0 ? errors.join(" | ").slice(0, 2_000) : null,
      rewardAttemptedAt: now,
      updatedAt: now,
    }).where(and(eq(referrals.id, referral.id), eq(referrals.status, "qualified")));
  }
};

const aggregateUsage = async (
  message: typeof sessionMessages.$inferSelect,
  spaceId: string,
  userId: string | null,
  usage: Usage | null,
) => {
  if (message.role !== "assistant" || message.usageAggregatedAt) return;
  const bucketStartAt = new Date(message.createdAt ?? new Date());
  bucketStartAt.setUTCMinutes(0, 0, 0);
  const inputTokens = finiteNumberOrZero(usage?.input);
  const outputTokens = finiteNumberOrZero(usage?.output);
  const cacheReadTokens = finiteNumberOrZero(usage?.cacheRead);
  const cacheWriteTokens = finiteNumberOrZero(usage?.cacheWrite);
  const totalTokens = finiteNumberOrZero(usage?.totalTokens);
  const costInput = finiteNumberOrZero(usage?.cost?.input);
  const costOutput = finiteNumberOrZero(usage?.cost?.output);
  const costCacheRead = finiteNumberOrZero(usage?.cost?.cacheRead);
  const costCacheWrite = finiteNumberOrZero(usage?.cost?.cacheWrite);
  const costTotal = finiteNumberOrZero(usage?.cost?.total);
  const success = !message.errorMessage && message.stopReason !== "error";

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(sessionMessages)
      .set({ usageAggregatedAt: new Date() })
      .where(and(eq(sessionMessages.id, message.id), isNull(sessionMessages.usageAggregatedAt)))
      .returning({ id: sessionMessages.id });
    if (!claimed) return;

    await tx.insert(tokenUsageStatsHourly).values({
      bucketStartAt,
      userId,
      spaceId,
      sessionId: message.sessionId,
      provider: message.provider,
      model: message.model,
      requestCount: 1,
      successCount: success ? 1 : 0,
      errorCount: success ? 0 : 1,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      costInput: String(costInput),
      costOutput: String(costOutput),
      costCacheRead: String(costCacheRead),
      costCacheWrite: String(costCacheWrite),
      costTotal: String(costTotal),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        tokenUsageStatsHourly.bucketStartAt,
        tokenUsageStatsHourly.userId,
        tokenUsageStatsHourly.spaceId,
        tokenUsageStatsHourly.sessionId,
        tokenUsageStatsHourly.provider,
        tokenUsageStatsHourly.model,
      ],
      set: {
        requestCount: sql`${tokenUsageStatsHourly.requestCount} + 1`,
        successCount: sql`${tokenUsageStatsHourly.successCount} + ${success ? 1 : 0}`,
        errorCount: sql`${tokenUsageStatsHourly.errorCount} + ${success ? 0 : 1}`,
        inputTokens: sql`${tokenUsageStatsHourly.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${tokenUsageStatsHourly.outputTokens} + ${outputTokens}`,
        cacheReadTokens: sql`${tokenUsageStatsHourly.cacheReadTokens} + ${cacheReadTokens}`,
        cacheWriteTokens: sql`${tokenUsageStatsHourly.cacheWriteTokens} + ${cacheWriteTokens}`,
        totalTokens: sql`${tokenUsageStatsHourly.totalTokens} + ${totalTokens}`,
        costInput: sql`${tokenUsageStatsHourly.costInput} + ${String(costInput)}::numeric`,
        costOutput: sql`${tokenUsageStatsHourly.costOutput} + ${String(costOutput)}::numeric`,
        costCacheRead: sql`${tokenUsageStatsHourly.costCacheRead} + ${String(costCacheRead)}::numeric`,
        costCacheWrite: sql`${tokenUsageStatsHourly.costCacheWrite} + ${String(costCacheWrite)}::numeric`,
        costTotal: sql`${tokenUsageStatsHourly.costTotal} + ${String(costTotal)}::numeric`,
        updatedAt: new Date(),
      },
    });
  });
};

registerSystemJob(SESSION_MESSAGE_POSTPROCESS_JOB, async (job: Job) => {
  const { sessionId, messageId } = job.data as SessionMessagePostprocessJobData;
  const [context] = await db
    .select({ message: sessionMessages, spaceId: spaceSessions.spaceId })
    .from(sessionMessages)
    .innerJoin(spaceSessions, eq(spaceSessions.id, sessionMessages.sessionId))
    .where(and(eq(sessionMessages.id, messageId), eq(sessionMessages.sessionId, sessionId)))
    .limit(1);
  if (!context) throw new Error(`Session message not found: ${messageId}`);
  const { message, spaceId } = context;
  if (message.role !== "assistant") return { ok: true, skipped: "non_assistant" };

  const usage = normalizeUsage(message.usage);
  const userId = await resolveActorUserId(message);

  // Idempotent external effects first; non-idempotent hourly aggregation must remain last.
  await recordBilling(message, userId, usage);
  await qualifyAndRewardReferral(message);
  await aggregateUsage(message, spaceId, userId, usage);

  return { ok: true };
});
