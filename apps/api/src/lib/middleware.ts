import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { AuthUserProfile } from "../auth.js";

/** AuthUserProfile with guaranteed uuid (returned after auth checks pass). */
export type AuthUser = AuthUserProfile & { uuid: string };

import { config } from "../config.js";
import { getSpaceSandboxBySpaceId } from "../space-sandboxes.js";
import type { spaces } from "../db/schema-v2.js";

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
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  return user as AuthUser;
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

// ── Internal request validation ──────────────────────────────────────────────

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

export const buildStorageRepoName = (spaceId: string) => `space-${spaceId}`;
