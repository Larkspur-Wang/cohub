import { and, eq, inArray, ne } from "drizzle-orm";
import type { AuthUser } from "./lib/middleware.js";
import { db } from "./db/index.js";
import { userProfiles } from "@cohub/db";
import { getLogtoUser, updateLogtoUserProfile } from "./logto-management.js";

export type PublicUserProfile = {
  userUuid: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type UserProfile = PublicUserProfile & {
  logtoUserId: string;
  syncedAt: string;
};

export class UsernameConflictError extends Error {
  override name = "UsernameConflictError";
}

type UserProfileFields = {
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  source: Record<string, unknown>;
};

type UserProfileRow = typeof userProfiles.$inferSelect;

const USERNAME_REGEX = /^(?!-)(?!.*--)[a-z0-9-]{1,39}(?<!-)$/;
const RESERVED_USERNAMES = new Set([
  "api",
  "auth",
  "admin",
  "assets",
  "callback",
  "explore",
  "favicon.ico",
  "invite",
  "login",
  "logout",
  "new",
  "org",
  "settings",
  "spaces",
  "static",
  "trending",
  "u",
  "user",
  "users",
  "teams",
]);

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

export function normalizeUsername(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!USERNAME_REGEX.test(normalized)) return null;
  if (RESERVED_USERNAMES.has(normalized)) return null;
  return normalized;
}

export function validateUsername(value: unknown) {
  if (value === null || value === undefined) {
    return { username: null, error: null };
  }
  if (typeof value !== "string") {
    return { username: null, error: "username must be a string or null" };
  }
  const normalized = normalizeUsername(value);
  if (!normalized) {
    return {
      username: null,
      error: "username must be 1-39 characters, lowercase letters, numbers, or hyphens, and cannot start or end with a hyphen",
    };
  }
  return { username: normalized, error: null };
}

function getUniqueViolationConstraint(error: unknown) {
  const record = error as { code?: string; constraint_name?: string; constraint?: string };
  if (record.code !== "23505") return null;
  return record.constraint_name ?? record.constraint ?? null;
}

export function normalizeUserProfile(input: {
  userUuid: string;
  source: Record<string, unknown>;
}): UserProfileFields {
  const source = input.source;
  const primaryEmail =
    stringValue(source, "primaryEmail") ??
    stringValue(source, "email") ??
    nestedStringValue(source, ["profile", "email"]);
  const username = normalizeUsername(
    stringValue(source, "username") ??
    nestedStringValue(source, ["profile", "username"]),
  );
  const displayName =
    stringValue(source, "name") ??
    nestedStringValue(source, ["profile", "name"]) ??
    stringValue(source, "nickname") ??
    stringValue(source, "nick_name") ??
    username ??
    emailLocalPart(primaryEmail) ??
    fallbackDisplayName(input.userUuid);
  const avatarUrl =
    stringValue(source, "avatar_url") ??
    stringValue(source, "picture") ??
    stringValue(source, "avatar") ??
    nestedStringValue(source, ["profile", "avatar"]) ??
    null;

  return {
    username,
    displayName: displayName.slice(0, 120),
    avatarUrl,
    source,
  };
}

const toUserProfile = (row: UserProfileRow): UserProfile => ({
  userUuid: row.userUuid,
  logtoUserId: row.logtoUserId,
  username: row.username ?? null,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl ?? null,
  syncedAt: row.syncedAt instanceof Date ? row.syncedAt.toISOString() : new Date().toISOString(),
});

const toPublicUserProfile = (row: UserProfileRow): PublicUserProfile => ({
  userUuid: row.userUuid,
  username: row.username ?? null,
  displayName: row.displayName,
  avatarUrl: row.avatarUrl ?? null,
});

async function upsertUserProfile(input: {
  userUuid: string;
  logtoUserId: string;
  fields: UserProfileFields;
}) {
  const now = new Date();
  try {
    const [row] = await db.insert(userProfiles).values({
      userUuid: input.userUuid,
      logtoUserId: input.logtoUserId,
      username: input.fields.username,
      displayName: input.fields.displayName,
      avatarUrl: input.fields.avatarUrl,
      source: input.fields.source,
      syncedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: userProfiles.userUuid,
      set: {
        logtoUserId: input.logtoUserId,
        username: input.fields.username,
        displayName: input.fields.displayName,
        avatarUrl: input.fields.avatarUrl,
        source: input.fields.source,
        syncedAt: now,
        updatedAt: now,
      },
    }).returning();

    if (!row) throw new Error("failed to upsert user profile");
    return toUserProfile(row);
  } catch (error) {
    const constraint = getUniqueViolationConstraint(error);
    if (constraint?.includes("username")) {
      throw new UsernameConflictError("username is already taken");
    }
    throw error;
  }
}

async function getStoredUserProfile(userUuid: string): Promise<UserProfile | null> {
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.userUuid, userUuid)).limit(1);
  return row ? toUserProfile(row) : null;
}

function sourceFromAuthUser(user: AuthUser): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(user).filter(([, value]) => value !== undefined),
  );
}

export async function ensureCurrentUserProfile(user: AuthUser): Promise<UserProfile> {
  const logtoUserId = typeof user.sub === "string" && user.sub.trim() ? user.sub.trim() : null;

  if (!logtoUserId) {
    const stored = await getStoredUserProfile(user.uuid);
    if (stored) return stored;

    return await upsertUserProfile({
      userUuid: user.uuid,
      logtoUserId: user.uuid,
      fields: normalizeUserProfile({ userUuid: user.uuid, source: sourceFromAuthUser(user) }),
    });
  }

  try {
    const logtoUser = await getLogtoUser(logtoUserId);
    return await upsertUserProfile({
      userUuid: user.uuid,
      logtoUserId,
      fields: normalizeUserProfile({ userUuid: user.uuid, source: logtoUser }),
    });
  } catch (error) {
    console.warn("[user-profile] Failed to refresh current user from Logto, using stored profile when available:", error);
    const stored = await getStoredUserProfile(user.uuid);
    if (stored) return stored;

    return await upsertUserProfile({
      userUuid: user.uuid,
      logtoUserId,
      fields: normalizeUserProfile({ userUuid: user.uuid, source: sourceFromAuthUser(user) }),
    });
  }
}

export async function updateCurrentUserProfile(user: AuthUser, input: { displayName?: string; avatarUrl?: string | null; username?: string | null }) {
  const logtoUserId = typeof user.sub === "string" && user.sub.trim() ? user.sub.trim() : null;
  if (!logtoUserId) throw new Error("current user is missing Logto user id");

  const username = input.username === undefined ? undefined : normalizeUsername(input.username);
  if (input.username !== undefined && input.username !== null && !username) {
    throw new Error("invalid username");
  }

  const previousLogtoUser = await getLogtoUser(logtoUserId);
  const previousFields = normalizeUserProfile({ userUuid: user.uuid, source: previousLogtoUser });

  if (username) {
    const existing = await db.select({ userUuid: userProfiles.userUuid }).from(userProfiles).where(
      and(eq(userProfiles.username, username), ne(userProfiles.userUuid, user.uuid)),
    ).limit(1);
    if (existing.length > 0) {
      throw new UsernameConflictError("username is already taken");
    }
  }

  await updateLogtoUserProfile(logtoUserId, {
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    username: username === undefined ? undefined : username,
  });

  try {
    const updated = await getLogtoUser(logtoUserId);
    return await upsertUserProfile({
      userUuid: user.uuid,
      logtoUserId,
      fields: normalizeUserProfile({ userUuid: user.uuid, source: updated }),
    });
  } catch (error) {
    await updateLogtoUserProfile(logtoUserId, {
      displayName: previousFields.displayName,
      avatarUrl: previousFields.avatarUrl,
      username: previousFields.username,
    }).catch((rollbackError) => {
      console.warn("[user-profile] Failed to roll back Logto profile after local update failure:", rollbackError);
    });
    throw error;
  }
}

export async function getProfilesByUuids(userUuids: string[]): Promise<Map<string, PublicUserProfile>> {
  const unique = [...new Set(userUuids.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db.select().from(userProfiles).where(inArray(userProfiles.userUuid, unique));
  return new Map(rows.map((row) => [row.userUuid, toPublicUserProfile(row)]));
}

export async function getProfilesByUsernames(usernames: string[]): Promise<Map<string, PublicUserProfile>> {
  const unique = [...new Set(usernames.map((value) => normalizeUsername(value)).filter((value): value is string => Boolean(value)))];
  if (unique.length === 0) return new Map();

  const rows = await db.select().from(userProfiles).where(inArray(userProfiles.username, unique));
  return new Map(rows
    .filter((row): row is typeof row & { username: string } => Boolean(row.username))
    .map((row) => [row.username, toPublicUserProfile(row)]));
}

export async function getProfileByUsername(username: string): Promise<PublicUserProfile | null> {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const [row] = await db.select().from(userProfiles).where(eq(userProfiles.username, normalized)).limit(1);
  return row ? toPublicUserProfile(row) : null;
}

export function fallbackPublicUserProfile(userUuid: string): PublicUserProfile {
  return {
    userUuid,
    username: null,
    displayName: fallbackDisplayName(userUuid),
    avatarUrl: null,
  };
}
