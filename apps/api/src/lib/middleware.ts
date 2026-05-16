import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { AuthUserProfile } from "../auth.js";
import type { ExecutionAuthPrincipal } from "../auth.js";

/** AuthUserProfile with guaranteed uuid (returned after auth checks pass). */
export type AuthUser = AuthUserProfile & { uuid: string };

export class UnauthorizedError extends Error {
  override name = "UnauthorizedError";
  constructor(message = "unauthorized") {
    super(message);
  }
}
export type RequestPrincipal =
  | { type: "user"; user: AuthUser }
  | { type: "execution"; execution: ExecutionAuthPrincipal };

import { config } from "../config.js";
import { getProfilesByUuids } from "../user-profiles.js";
import { getSpaceSandboxBySpaceId } from "../space-sandboxes.js";
import { spaceSandboxes } from "@cohub/db-schema";
import { db } from "../db/index.js";
import { inArray } from "drizzle-orm";
import type { spaces } from "@cohub/db-schema";

const principalToAuthUser = (principal: RequestPrincipal | null | undefined): AuthUser | null => {
  if (principal?.type === "user") return principal.user;
  if (principal?.type === "execution" && principal.execution.actorUserId) {
    return {
      uuid: principal.execution.actorUserId,
      id: undefined,
      nick_name: undefined,
      phone_num: undefined,
      avatar_url: undefined,
    } satisfies AuthUser;
  }
  return null;
};

// ── ID validation ────────────────────────────────────────────────────────────

/** Standard UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Short UUID (no hyphens): xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx */
const SHORT_UUID_REGEX = /^[0-9a-f]{32}$/i;

export const requireValidId = (value: string | null | undefined) =>
  Boolean(value && (UUID_REGEX.test(value) || SHORT_UUID_REGEX.test(value)));

// ── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the authenticated user or a 401 JSON Response.
 * Callers should use `useAuth(c)` for a type-safe return.
 */
export const requireAuth = (c: Context): AuthUser | Response => {
  const user = getOptionalAuth(c);
  if (user) return user;
  throw new UnauthorizedError();
};

/**
 * Type-safe auth check: returns AuthUser directly.
 * If unauthenticated, the 401 Response is returned from the handler automatically.
 * Usage: `const user = useAuth(c);`
 */
export const useAuth = (c: Context): AuthUser => {
  const result = requireAuth(c);
  return result as AuthUser;
};

/**
 * Returns the authenticated user when present, otherwise null.
 * Use this for routes whose authorization is fully determined by RBAC
 * policies, including signed-in and anonymous access policies.
 */
export const getOptionalAuth = (c: Context): AuthUser | null => {
  return principalToAuthUser(c.get("principal") as RequestPrincipal | null | undefined);
};

export const getExecutionPrincipal = (c: Context): ExecutionAuthPrincipal | null => {
  const principal = c.get("principal") as RequestPrincipal | null | undefined;
  return principal?.type === "execution" ? principal.execution : null;
};

// ── Internal request validation ──────────────────────────────────────────────

export const getRequestRemoteAddress = (c: Context) => {
  const info = getConnInfo(c);
  return info.remote.address || null;
};

export const isPrivateNetworkAddress = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  const normalized = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  if (normalized === "127.0.0.1" || normalized === "::1") return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;

  const ipv4Match = normalized.match(/^172\.(\d{1,3})\./);
  if (ipv4Match) {
    const secondOctet = Number.parseInt(ipv4Match[1] ?? "", 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;

  return false;
};

export const ensureInternalRequest = (c: Context) => {
  const secret = c.req.header("x-worker-secret");
  const expectedSecret = config.workerSecret;
  if (!secret || !expectedSecret) return c.json({ message: "forbidden" }, 403);
  const provided = new TextEncoder().encode(secret);
  const expected = new TextEncoder().encode(expectedSecret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return c.json({ message: "forbidden" }, 403);
  }
  return null;
};

// ── Space helpers ────────────────────────────────────────────────────────────

export const buildSpaceListItem = async (space: typeof spaces.$inferSelect) => {
  const sandbox = await getSpaceSandboxBySpaceId(space.id);
  return {
    ...space,
    sandboxStatus: sandbox?.status ?? null,
  };
};

/**
 * Batch version: fetches sandbox statuses for all spaces in a single query
 * and returns the space list with sandboxStatus attached.
 */
export const buildSpaceListItems = async (spaceList: typeof spaces.$inferSelect[]) => {
  if (spaceList.length === 0) return [];

  const sandboxRows = await db
    .select({ spaceId: spaceSandboxes.spaceId, status: spaceSandboxes.status })
    .from(spaceSandboxes)
    .where(inArray(spaceSandboxes.spaceId, spaceList.map((s) => s.id)));

  const statusBySpaceId = new Map(sandboxRows.map((r) => [r.spaceId, r.status]));
  const profileByUserUuid = await getProfilesByUuids(spaceList.map((space) => space.userUuid));

  return spaceList.map((space) => ({
    ...space,
    sandboxStatus: statusBySpaceId.get(space.id) ?? null,
    ownerProfile: profileByUserUuid.get(space.userUuid) ?? null,
  }));
};

export const buildStorageRepoName = (spaceId: string) => `space-${spaceId}`;
