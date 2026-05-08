import { inArray } from "drizzle-orm";
import type { AuthUser } from "./lib/middleware.js";
import { db } from "./db/index.js";
import { userProfiles } from "./db/schema-v2.js";
import { getLogtoUser, updateLogtoUserProfile } from "./logto-management.js";

export type PublicUserProfile = {
  userUuid: string;
  displayName: string;
  avatarUrl: string | null;
};

export type UserProfile = PublicUserProfile & {
  logtoUserId: string;
  syncedAt: string;
};

type UserProfileFields = {
  displayName: string;
  avatarUrl: string | null;
  source: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringValue = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const nestedStringValue = (source: Record<string, unknown>, path: string[]) => {
  let current: unknown = source;
  for (const key of path) current = asRecord(current)[key];
  return typeof current === "string" && current.trim() ? current.trim() : null;
};

const emailLocalPart = (value: string | null) => {
  if (!value) return null;
  const [local] = value.split("@");
  return local?.trim() || null;
};

const fallbackDisplayName = (userUuid: string) => userUuid.replaceAll("-", "").slice(0, 8);

export function normalizeUserProfile(input: {
  userUuid: string;
  source: Record<string, unknown>;
}): UserProfileFields {
  const source = input.source;
  const primaryEmail =
    stringValue(source, "primaryEmail") ??
    stringValue(source, "email") ??
    nestedStringValue(source, ["profile", "email"]);
  const displayName =
    stringValue(source, "name") ??
    nestedStringValue(source, ["profile", "name"]) ??
    stringValue(source, "nickname") ??
    stringValue(source, "nick_name") ??
    stringValue(source, "username") ??
    emailLocalPart(primaryEmail) ??
    fallbackDisplayName(input.userUuid);
  const avatarUrl =
    stringValue(source, "avatar_url") ??
    stringValue(source, "picture") ??
    stringValue(source, "avatar") ??
    nestedStringValue(source, ["profile", "avatar"]) ??
    null;

  return {
    displayName: displayName.slice(0, 120),
    avatarUrl,
    source,
  };
}

const toUserProfile = (row: typeof userProfiles.$inferSelect): UserProfile => ({
  userUuid: row.userUuid,
  logtoUserId: row.logtoUserId,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl ?? null,
  syncedAt: row.syncedAt instanceof Date ? row.syncedAt.toISOString() : new Date().toISOString(),
});

const toPublicUserProfile = (row: typeof userProfiles.$inferSelect): PublicUserProfile => ({
  userUuid: row.userUuid,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl ?? null,
});

async function upsertUserProfile(input: {
  userUuid: string;
  logtoUserId: string;
  fields: UserProfileFields;
}) {
  const now = new Date();
  const [row] = await db.insert(userProfiles).values({
    userUuid: input.userUuid,
    logtoUserId: input.logtoUserId,
    displayName: input.fields.displayName,
    avatarUrl: input.fields.avatarUrl,
    source: input.fields.source,
    syncedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: userProfiles.userUuid,
    set: {
      logtoUserId: input.logtoUserId,
      displayName: input.fields.displayName,
      avatarUrl: input.fields.avatarUrl,
      source: input.fields.source,
      syncedAt: now,
      updatedAt: now,
    },
  }).returning();

  if (!row) throw new Error("failed to upsert user profile");
  return toUserProfile(row);
}

function sourceFromAuthUser(user: AuthUser): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(user).filter(([, value]) => value !== undefined),
  );
}

export async function ensureCurrentUserProfile(user: AuthUser): Promise<UserProfile> {
  const logtoUserId = typeof user.sub === "string" && user.sub.trim() ? user.sub.trim() : null;
  if (!logtoUserId) throw new Error("current user is missing Logto user id");

  try {
    const logtoUser = await getLogtoUser(logtoUserId);
    return await upsertUserProfile({
      userUuid: user.uuid,
      logtoUserId,
      fields: normalizeUserProfile({ userUuid: user.uuid, source: logtoUser }),
    });
  } catch (error) {
    console.warn("[user-profile] Failed to refresh current user from Logto, falling back to token claims:", error);
    return await upsertUserProfile({
      userUuid: user.uuid,
      logtoUserId,
      fields: normalizeUserProfile({ userUuid: user.uuid, source: sourceFromAuthUser(user) }),
    });
  }
}

export async function updateCurrentUserProfile(user: AuthUser, input: { displayName?: string; avatarUrl?: string | null }) {
  const logtoUserId = typeof user.sub === "string" && user.sub.trim() ? user.sub.trim() : null;
  if (!logtoUserId) throw new Error("current user is missing Logto user id");

  await updateLogtoUserProfile(logtoUserId, input);
  const updated = await getLogtoUser(logtoUserId);
  return await upsertUserProfile({
    userUuid: user.uuid,
    logtoUserId,
    fields: normalizeUserProfile({ userUuid: user.uuid, source: updated }),
  });
}

export async function getProfilesByUuids(userUuids: string[]): Promise<Map<string, PublicUserProfile>> {
  const unique = [...new Set(userUuids.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db.select().from(userProfiles).where(inArray(userProfiles.userUuid, unique));
  return new Map(rows.map((row) => [row.userUuid, toPublicUserProfile(row)]));
}

export function fallbackPublicUserProfile(userUuid: string): PublicUserProfile {
  return {
    userUuid,
    displayName: fallbackDisplayName(userUuid),
    avatarUrl: null,
  };
}
