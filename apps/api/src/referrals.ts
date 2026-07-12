import { randomBytes } from "node:crypto";
import {
  referralCodes,
  referrals,
  sessionTurns,
  userProfiles,
  type ReferralStatus,
} from "@cohub/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db/index.js";

export const REFERRAL_REWARD_USD = 5;

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
