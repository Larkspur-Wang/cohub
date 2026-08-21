import { createBatchDrizzlePermissionStore, hasPermission as hasSharedPermission, isUserLevelPermission, normalizePermissionScopes, resolvePermissionAccess as resolveSharedPermissionAccess, scopeListHasPermission } from "@cohub/core/permissions";
import { db } from "./db/index.js";
import type { AuthUserProfile } from "./auth.js";
import { appViewerGrants, type SpaceRole } from "@cohub/db";
import type { Permission, AccessPolicy, PermissionAccess } from "@cohub/core/permissions";
import type { PreviewSessionPrincipal } from "./preview-sessions.js";
import { hasPreviewSessionPermission } from "./preview-sessions.js";
import type { AppSessionPrincipal } from "./app-sessions.js";
import { eq } from "drizzle-orm";

type CachedAppSessionPrincipal = AppSessionPrincipal & {
  activeViewerGrantScopes?: Promise<Permission[]>;
};

type ScopedExecutionPrincipal = {
  spaceId: string;
  scopes?: Permission[];
};

const permissionStore = createBatchDrizzlePermissionStore(db);

export type { Audience, Permission } from "@cohub/core/permissions";

export async function getSpaceMemberRole(spaceId: string, userId: string): Promise<SpaceRole | null> {
  return permissionStore.getSpaceMemberRole(spaceId, userId);
}

const getUserAppSession = (user: AuthUserProfile | null): CachedAppSessionPrincipal | null => {
  const session = (user as (AuthUserProfile & { appSession?: CachedAppSessionPrincipal }) | null)?.appSession;
  if (!session || user?.uuid !== session.userUuid) return null;
  return session;
};

const getUserExecution = (user: AuthUserProfile | null): ScopedExecutionPrincipal | null => {
  const execution = (user as (AuthUserProfile & { execution?: ScopedExecutionPrincipal }) | null)?.execution;
  if (!execution || !Array.isArray(execution.scopes)) return null;
  return execution;
};

const getUserPreviewSession = (user: AuthUserProfile | null): PreviewSessionPrincipal | null => {
  const session = (user as (AuthUserProfile & { previewSession?: PreviewSessionPrincipal }) | null)?.previewSession;
  if (!session || user?.uuid !== session.userUuid) return null;
  return session;
};

/**
 * Strip app-session/preview/execution principal scopes for account-level handlers
 * (`user.space.list` / `user.session.list` / `user.usage.read`).
 * Gate with the original principal; load data with this identity.
 */
export function asAccountIdentity(user: { uuid?: string | null } | null | undefined): { uuid: string } | null {
  const uuid = typeof user?.uuid === "string" ? user.uuid.trim() : "";
  return uuid ? { uuid } : null;
}

/** Account owners may access their own Task Runs; Works need explicit viewer consent. */
export async function canAccessOwnTaskRuns(user: AuthUserProfile | null) {
  const appSession = getUserAppSession(user);
  if (appSession) return hasActiveViewerGrantPermission(appSession, "taskrun.view");
  return Boolean(user?.uuid);
}

export async function canAccessUnscopedTaskRun(
  user: AuthUserProfile | null,
  ownerUserUuid: string | null,
) {
  return Boolean(
    user &&
      ownerUserUuid === user.uuid &&
      (await canAccessOwnTaskRuns(user)),
  );
}

const loadActiveViewerGrantScopes = async (appSession: CachedAppSessionPrincipal) => {
  if (!appSession.appViewerGrantId) return [] as Permission[];
  const [grant] = await db
    .select({ scopes: appViewerGrants.scopes, expiresAt: appViewerGrants.expiresAt, revokedAt: appViewerGrants.revokedAt })
    .from(appViewerGrants)
    .where(eq(appViewerGrants.id, appSession.appViewerGrantId))
    .limit(1);
  if (!grant || grant.revokedAt) return [];
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) return [];
  const tokenScopes = new Set(normalizePermissionScopes(appSession.viewerScopes));
  return normalizePermissionScopes(grant.scopes as string[]).filter((scope) => tokenScopes.has(scope));
};

const getActiveViewerGrantScopes = async (appSession: CachedAppSessionPrincipal) => {
  appSession.activeViewerGrantScopes ??= loadActiveViewerGrantScopes(appSession);
  return appSession.activeViewerGrantScopes;
};

const hasActiveViewerGrantPermission = async (appSession: CachedAppSessionPrincipal, permission: Permission) => {
  if (!scopeListHasPermission(appSession.viewerScopes, permission)) return false;
  return scopeListHasPermission(await getActiveViewerGrantScopes(appSession), permission);
};

const resolveAppSessionScopes = async (appSession: CachedAppSessionPrincipal) => {
  const viewerScopes = await getActiveViewerGrantScopes(appSession);
  return normalizePermissionScopes([...appSession.appScopes, ...viewerScopes]);
};

const hasAppSessionScopedPermission = async (
  appSession: CachedAppSessionPrincipal,
  permission: Permission,
  context: { spaceId: string; sessionId?: string },
) => {
  if (
    appSession.spaceId === context.spaceId &&
    scopeListHasPermission(appSession.appScopes, permission)
  ) {
    return true;
  }
  if (!(await hasActiveViewerGrantPermission(appSession, permission))) return false;
  return hasSharedPermission({
    store: permissionStore,
    user: { uuid: appSession.userUuid },
    permission,
    context,
  });
};

export async function hasPermission(
  user: AuthUserProfile | null,
  permission: Permission,
  context: { spaceId: string; sessionId?: string },
): Promise<boolean> {
  // Account-level scopes are not bound to a space. App sessions need an
  // explicit viewer grant; publishers cannot pre-grant these via appScopes.
  // Handlers then load rows with asAccountIdentity (user membership/policy),
  // not app-session-scoped session.view / space.view.
  if (isUserLevelPermission(permission)) {
    const appSession = getUserAppSession(user);
    if (appSession) return hasActiveViewerGrantPermission(appSession, permission);
    return Boolean(user?.uuid);
  }

  const appSession = getUserAppSession(user);
  if (appSession) return hasAppSessionScopedPermission(appSession, permission, context);
  const previewSession = getUserPreviewSession(user);
  if (previewSession) return hasPreviewSessionPermission(previewSession, permission, context.spaceId);
  const execution = getUserExecution(user);
  if (execution?.spaceId === context.spaceId && scopeListHasPermission(normalizePermissionScopes(execution.scopes ?? []), permission)) return true;
  return hasSharedPermission({
    store: permissionStore,
    user,
    permission,
    context,
  });
}

export async function getRoleForSpaceUser(spaceId: string, userId: string): Promise<SpaceRole | null> {
  return getSpaceMemberRole(spaceId, userId);
}

export async function resolvePermissionAccess(
  user: AuthUserProfile | null,
  context: { spaceId: string; sessionId?: string },
): Promise<PermissionAccess> {
  const appSession = getUserAppSession(user);
  if (appSession && appSession.spaceId === context.spaceId) {
    return { role: null, permissions: await resolveAppSessionScopes(appSession) };
  }
  const previewSession = getUserPreviewSession(user);
  if (previewSession?.spaceId === context.spaceId) return { role: null, permissions: normalizePermissionScopes(previewSession.scopes) };
  const execution = getUserExecution(user);
  if (execution?.spaceId === context.spaceId) return { role: null, permissions: normalizePermissionScopes(execution.scopes ?? []) };
  return resolveSharedPermissionAccess({
    store: permissionStore,
    user,
    context,
  });
}

export async function getSessionSpaceId(sessionId: string): Promise<string | null> {
  return permissionStore.getSessionSpaceId(sessionId);
}

type SpaceSessionRow = typeof import("@cohub/db").spaceSessions.$inferSelect;
type AccessPolicyRow = AccessPolicy | null;

export async function filterSessionsByPermission(
  user: AuthUserProfile | null,
  permission: Permission,
  spaceId: string,
  sessions: SpaceSessionRow[],
  spacePolicy?: AccessPolicyRow,
): Promise<SpaceSessionRow[]> {
  const appSession = getUserAppSession(user);
  if (appSession) {
    return await hasAppSessionScopedPermission(appSession, permission, { spaceId }) ? sessions : [];
  }
  const previewSession = getUserPreviewSession(user);
  if (previewSession) return hasPreviewSessionPermission(previewSession, permission, spaceId) ? sessions : [];
  const execution = getUserExecution(user);
  if (execution?.spaceId === spaceId) return scopeListHasPermission(normalizePermissionScopes(execution.scopes ?? []), permission) ? sessions : [];
  return permissionStore.filterSessionsByPermission({
    user,
    permission,
    spaceId,
    sessions,
    spacePolicy,
  });
}

/**
 * Batch form of `hasPermission` for many spaces. App-session/preview/execution
 * principals are scoped to a single space, so they only ever match that one;
 * ordinary users fall through to a 1–2 query membership + policy lookup.
 */
export async function filterSpaceIdsByPermission(
  user: AuthUserProfile | null,
  permission: Permission,
  spaceIds: readonly string[],
): Promise<string[]> {
  if (spaceIds.length === 0) return [];

  const appSession = getUserAppSession(user);
  if (appSession) {
    const allowed = await Promise.all(
      spaceIds.map((spaceId) =>
        hasAppSessionScopedPermission(appSession, permission, { spaceId }),
      ),
    );
    return spaceIds.filter((_, index) => allowed[index]);
  }

  const previewSession = getUserPreviewSession(user);
  if (previewSession) {
    return hasPreviewSessionPermission(previewSession, permission, previewSession.spaceId)
      ? spaceIds.filter((id) => id === previewSession.spaceId)
      : [];
  }

  const execution = getUserExecution(user);
  if (execution) {
    return scopeListHasPermission(normalizePermissionScopes(execution.scopes ?? []), permission)
      ? spaceIds.filter((id) => id === execution.spaceId)
      : [];
  }

  return permissionStore.filterSpaceIdsByPermission({ user, permission, spaceIds });
}
