import { normalizePermissionScopes, type Permission } from "../permissions/index.js";
import type { DelegatedPromptAuthContext, PromptAuthContext } from "./prompt.js";

export function getPromptAuthScopes(auth: unknown, spaceId: string, now = Date.now): Permission[] {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return [];
  const context = auth as { type?: unknown; spaceId?: unknown; exp?: unknown; scopes?: unknown };
  if ((context.type !== "app_session" && context.type !== "delegated_prompt") || context.spaceId !== spaceId || !Array.isArray(context.scopes)) return [];
  if (typeof context.exp !== "number" || !Number.isFinite(context.exp) || context.exp * 1000 <= now()) return [];
  return normalizePermissionScopes(context.scopes);
}

export function createDelegatedPromptAuth(input: {
  source: string;
  actorUserId: string;
  spaceId: string;
  scopes: readonly string[];
  appScopes?: readonly string[];
  viewerScopes?: readonly string[];
  appId?: string | null;
  appViewerGrantId?: string | null;
  delegatedAt?: string;
  exp: number;
}): DelegatedPromptAuthContext | null {
  const scopes = normalizePermissionScopes(input.scopes);
  if (scopes.length === 0 || !Number.isFinite(input.exp) || input.exp * 1000 <= Date.now()) return null;
  return {
    type: "delegated_prompt",
    source: input.source.trim() || "delegated_prompt",
    actorUserId: input.actorUserId,
    appId: input.appId ?? null,
    spaceId: input.spaceId,
    scopes,
    appScopes: normalizePermissionScopes(input.appScopes ?? scopes),
    viewerScopes: normalizePermissionScopes(input.viewerScopes ?? []),
    delegatedAt: input.delegatedAt ?? new Date().toISOString(),
    exp: input.exp,
    appViewerGrantId: input.appViewerGrantId ?? null,
  };
}

export function promptAuthMatchesSpace(auth: PromptAuthContext | null | undefined, spaceId: string) {
  return Boolean(auth && auth.spaceId === spaceId);
}
