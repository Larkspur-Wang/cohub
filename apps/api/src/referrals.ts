import { randomBytes } from "node:crypto";
import { billingOperations } from "@cohub/billing";
import {
  referralCodes,
  referrals,
  sessionTurns,
  userProfiles,
  type ReferralStatus,
} from "@cohub/db";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { createLogger } from "@cohub/infra/logging";

const logger = createLogger({ serviceName: "cohub-api" });

export const REFERRAL_REWARD_USD = 5;

const REWARD_LEASE_MS = 5 * 60_000;
const successfulTurnStatuses = ["completed"] as const;

function generateReferralCode() {
  return randomBytes(9).toString("base64url");
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export async function ensureReferralCode(userId: string) {
  const [existing] = await db
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.userId, userId), eq(referralCodes.status, "active")))
    .limit(1);
  if (existing) return existing;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [created] = await db
      .insert(referralCodes)
      .values({ userId, code: generateReferralCode() })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    const [concurrent] = await db
      .select()
      .from(referralCodes)
      .where(and(eq(referralCodes.userId, userId), eq(referralCodes.status, "active")))
      .limit(1);
    if (concurrent) return concurrent;
  }
  throw new Error("failed to create referral code");
}

export async function rotateReferralCode(userId: string) {
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx
      .update(referralCodes)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(and(eq(referralCodes.userId, userId), eq(referralCodes.status, "active")));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [created] = await tx
        .insert(referralCodes)
        .values({ userId, code: generateReferralCode() })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
    }
    throw new Error("failed to rotate referral code");
  });
}

export async function getPublicReferral(code: string) {
  const [result] = await db
    .select({
      codeId: referralCodes.id,
      inviterUserId: referralCodes.userId,
      profile: {
        userUuid: userProfiles.userUuid,
        username: userProfiles.username,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
      },
    })
    .from(referralCodes)
    .leftJoin(userProfiles, eq(userProfiles.userUuid, referralCodes.userId))
    .where(and(eq(referralCodes.code, code), eq(referralCodes.status, "active")))
    .limit(1);
  return result ?? null;
}

export type ClaimReferralResult = {
  referralId: string | null;
  status: ReferralStatus | "self" | "existing_user" | "already_claimed";
};

export async function claimReferral(code: string, inviteeUserId: string): Promise<ClaimReferralResult | null> {
  const publicReferral = await getPublicReferral(code);
  if (!publicReferral) return null;
  if (publicReferral.inviterUserId === inviteeUserId) {
    return { referralId: null, status: "self" };
  }

  const [existing] = await db
    .select({
      id: referrals.id,
      referralCodeId: referrals.referralCodeId,
      status: referrals.status,
    })
    .from(referrals)
    .where(eq(referrals.inviteeUserId, inviteeUserId))
    .limit(1);
  if (existing) {
    return {
      referralId: existing.id,
      status:
        existing.referralCodeId === publicReferral.codeId
          ? existing.status
          : "already_claimed",
    };
  }

  const [successfulTurn] = await db
    .select({ id: sessionTurns.id })
    .from(sessionTurns)
    .where(
      and(
        eq(sessionTurns.userUuid, inviteeUserId),
        inArray(sessionTurns.status, [...successfulTurnStatuses]),
      ),
    )
    .limit(1);
  if (successfulTurn) return { referralId: null, status: "existing_user" };

  const [created] = await db
    .insert(referrals)
    .values({
      referralCodeId: publicReferral.codeId,
      inviterUserId: publicReferral.inviterUserId,
      inviteeUserId,
      inviterRewardAmountUsd: String(REFERRAL_REWARD_USD),
      inviteeRewardAmountUsd: String(REFERRAL_REWARD_USD),
    })
    .onConflictDoNothing({ target: referrals.inviteeUserId })
    .returning({ id: referrals.id, status: referrals.status });

  if (created) return { referralId: created.id, status: created.status };
  const [concurrent] = await db
    .select({
      id: referrals.id,
      referralCodeId: referrals.referralCodeId,
      status: referrals.status,
    })
    .from(referrals)
    .where(eq(referrals.inviteeUserId, inviteeUserId))
    .limit(1);
  if (!concurrent) return null;
  return {
    referralId: concurrent.id,
    status:
      concurrent.referralCodeId === publicReferral.codeId
        ? concurrent.status
        : "already_claimed",
  };
}

async function grantReferralSide(input: {
  referralId: string;
  userId: string;
  side: "inviter" | "invitee";
  expectedAmountUsd: number;
}) {
  return billingOperations.grantReferralReward({
    userId: input.userId,
    referralId: input.referralId,
    side: input.side,
    expectedAmountUsd: input.expectedAmountUsd,
    operationId: `referral:${input.referralId}:${input.side}`,
  });
}

const rewardErrorMessage = (side: "inviter" | "invitee", error: unknown) =>
  `${side}: ${error instanceof Error ? error.message : String(error)}`;

async function loadReferralByInvitee(inviteeUserId: string) {
  const [row] = await db
    .select()
    .from(referrals)
    .where(eq(referrals.inviteeUserId, inviteeUserId))
    .limit(1);
  return row ?? null;
}

/**
 * Qualify one referral and grant both rewards.
 *
 * Flow keeps DB transactions short:
 * 1. CAS `pending → qualified`
 * 2. Acquire a short DB lease before calling Billing
 * 3. Call Billing outside any transaction (operation_id + HTTP idempotency key)
 * 4. Persist each side and release the lease
 */
type ReferralRow = NonNullable<Awaited<ReturnType<typeof loadReferralByInvitee>>>;

async function rewardQualifiedReferral(current: ReferralRow) {
  if (current.status !== "qualified") return current;
  if (!billingOperations.status.configured) {
    logger.warn("[Referrals] reward pending because billing is unavailable", {
      referralId: current.id,
      inviteeUserId: current.inviteeUserId,
      reason: billingOperations.status.reason,
    });
    return current;
  }

  const attemptStartedAt = new Date();
  const leaseToken = randomBytes(16).toString("hex");
  const leaseExpiresAt = new Date(attemptStartedAt.getTime() + REWARD_LEASE_MS);
  const [leased] = await db
    .update(referrals)
    .set({
      rewardAttemptedAt: attemptStartedAt,
      rewardLeaseToken: leaseToken,
      rewardLeaseExpiresAt: leaseExpiresAt,
      updatedAt: attemptStartedAt,
    })
    .where(
      and(
        eq(referrals.id, current.id),
        eq(referrals.status, "qualified"),
        or(
          isNull(referrals.rewardLeaseExpiresAt),
          lt(referrals.rewardLeaseExpiresAt, attemptStartedAt),
        ),
      ),
    )
    .returning();
  if (!leased) return loadReferralByInvitee(current.inviteeUserId);

  const errors: string[] = [];

  if (!current.inviteeRewardedAt) {
    try {
      const result = await grantReferralSide({
        referralId: current.id,
        userId: current.inviteeUserId,
        side: "invitee",
        expectedAmountUsd: Number(current.inviteeRewardAmountUsd),
      });
      const rewardedAt = new Date();
      if (result.amountUsd !== Number(current.inviteeRewardAmountUsd)) {
        logger.warn("[Referrals] invitee reward amount differs from expected", {
          referralId: current.id,
          expectedAmountUsd: Number(current.inviteeRewardAmountUsd),
          actualAmountUsd: result.amountUsd,
        });
      }
      await db
        .update(referrals)
        .set({
          inviteeRewardedAt: rewardedAt,
          inviteeRewardAmountUsd: String(result.amountUsd),
          rewardAttemptedAt: rewardedAt,
          updatedAt: rewardedAt,
        })
        .where(
          and(
            eq(referrals.id, leased.id),
            eq(referrals.rewardLeaseToken, leaseToken),
            isNull(referrals.inviteeRewardedAt),
          ),
        );
    } catch (error) {
      errors.push(rewardErrorMessage("invitee", error));
    }
  }

  const afterInvitee = (await loadReferralByInvitee(current.inviteeUserId)) ?? leased;
  if (afterInvitee.rewardLeaseToken !== leaseToken) return afterInvitee;
  if (!afterInvitee.inviterRewardedAt) {
    try {
      const result = await grantReferralSide({
        referralId: afterInvitee.id,
        userId: afterInvitee.inviterUserId,
        side: "inviter",
        expectedAmountUsd: Number(afterInvitee.inviterRewardAmountUsd),
      });
      const rewardedAt = new Date();
      if (result.amountUsd !== Number(afterInvitee.inviterRewardAmountUsd)) {
        logger.warn("[Referrals] inviter reward amount differs from expected", {
          referralId: afterInvitee.id,
          expectedAmountUsd: Number(afterInvitee.inviterRewardAmountUsd),
          actualAmountUsd: result.amountUsd,
        });
      }
      await db
        .update(referrals)
        .set({
          inviterRewardedAt: rewardedAt,
          inviterRewardAmountUsd: String(result.amountUsd),
          rewardAttemptedAt: rewardedAt,
          updatedAt: rewardedAt,
        })
        .where(
          and(
            eq(referrals.id, afterInvitee.id),
            eq(referrals.rewardLeaseToken, leaseToken),
            isNull(referrals.inviterRewardedAt),
          ),
        );
    } catch (error) {
      errors.push(rewardErrorMessage("inviter", error));
    }
  }

  const latest = (await loadReferralByInvitee(current.inviteeUserId)) ?? leased;
  if (latest.status === "rewarded" || latest.rewardLeaseToken !== leaseToken) return latest;

  const bothRewarded = Boolean(latest.inviteeRewardedAt && latest.inviterRewardedAt);
  const rewardError = errors.length > 0 ? errors.join(" | ").slice(0, 2000) : null;

  if (bothRewarded) {
    const completedAt = new Date();
    const [updated] = await db
      .update(referrals)
      .set({
        status: "rewarded",
        rewardedAt: latest.rewardedAt ?? completedAt,
        rewardError: null,
        rewardAttemptedAt: completedAt,
        rewardLeaseToken: null,
        rewardLeaseExpiresAt: null,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(referrals.id, latest.id),
          eq(referrals.status, "qualified"),
          eq(referrals.rewardLeaseToken, leaseToken),
        ),
      )
      .returning();
    return updated ?? (await loadReferralByInvitee(current.inviteeUserId));
  }

  const attemptCompletedAt = new Date();
  const [updated] = await db
    .update(referrals)
    .set({
      rewardError,
      rewardAttemptedAt: attemptCompletedAt,
      rewardLeaseToken: null,
      rewardLeaseExpiresAt: null,
      updatedAt: attemptCompletedAt,
    })
    .where(
      and(
        eq(referrals.id, latest.id),
        eq(referrals.status, "qualified"),
        eq(referrals.rewardLeaseToken, leaseToken),
      ),
    )
    .returning();

  if (errors.length > 0) {
    logger.warn("[Referrals] reward grant failed", { referralId: latest.id, errors });
  }

  return updated ?? (await loadReferralByInvitee(current.inviteeUserId));
}

export async function qualifyAndRewardReferral(inviteeUserId: string) {
  const qualifiedAt = new Date();
  const [qualified] = await db
    .update(referrals)
    .set({ status: "qualified", qualifiedAt, updatedAt: qualifiedAt })
    .where(and(eq(referrals.inviteeUserId, inviteeUserId), eq(referrals.status, "pending")))
    .returning();
  if (!qualified) return null;
  return rewardQualifiedReferral(qualified);
}

export async function retryQualifiedReferralRewards(limit = 50) {
  const retryBefore = new Date(Date.now() - 5 * 60_000);
  const retryable = await db
    .select()
    .from(referrals)
    .where(
      and(
        eq(referrals.status, "qualified"),
        or(
          isNull(referrals.rewardAttemptedAt),
          lt(referrals.rewardAttemptedAt, retryBefore),
        ),
      ),
    )
    .orderBy(sql`${referrals.rewardAttemptedAt} asc nulls first`)
    .limit(Math.max(1, Math.min(limit, 100)));

  let rewarded = 0;
  for (const referral of retryable) {
    const result = await rewardQualifiedReferral(referral);
    if (result?.status === "rewarded") rewarded += 1;
  }
  return { attempted: retryable.length, rewarded };
}

let rewardRetryRunning = false;

export function startReferralRewardRetryLoop(intervalMs = 60_000) {
  const run = async () => {
    if (rewardRetryRunning || !billingOperations.status.configured) return;
    rewardRetryRunning = true;
    try {
      const result = await retryQualifiedReferralRewards();
      if (result.attempted > 0) {
        logger.info("[Referrals] reward retry completed", result);
      }
    } catch (error) {
      logger.warn("[Referrals] reward retry failed", { error });
    } finally {
      rewardRetryRunning = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export async function getReferralDashboard(userId: string) {
  const code = await ensureReferralCode(userId);
  const items = await db
    .select({
      id: referrals.id,
      status: referrals.status,
      claimedAt: referrals.claimedAt,
      qualifiedAt: referrals.qualifiedAt,
      rewardedAt: referrals.rewardedAt,
      inviterRewardAmountUsd: referrals.inviterRewardAmountUsd,
      profile: {
        userUuid: userProfiles.userUuid,
        username: userProfiles.username,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
      },
    })
    .from(referrals)
    .leftJoin(userProfiles, eq(userProfiles.userUuid, referrals.inviteeUserId))
    .where(eq(referrals.inviterUserId, userId))
    .orderBy(desc(referrals.claimedAt));

  const pending = items.filter((item) => item.status === "pending").length;
  const qualified = items.filter((item) => item.status === "qualified").length;
  const rewardedItems = items.filter((item) => item.status === "rewarded");
  const rewarded = rewardedItems.length;
  const earnedUsd = Number(
    rewardedItems
      .reduce((total, item) => total + Number(item.inviterRewardAmountUsd), 0)
      .toFixed(8),
  );
  return {
    code: code.code,
    reward: { inviterUsd: REFERRAL_REWARD_USD, inviteeUsd: REFERRAL_REWARD_USD },
    summary: {
      total: items.length,
      pending,
      qualified,
      rewarded,
      earnedUsd,
    },
    items: items.map(({ inviterRewardAmountUsd: _, ...item }) => ({
      ...item,
      claimedAt: toIso(item.claimedAt),
      qualifiedAt: toIso(item.qualifiedAt),
      rewardedAt: toIso(item.rewardedAt),
      profile: item.profile?.userUuid ? item.profile : null,
    })),
  };
}
