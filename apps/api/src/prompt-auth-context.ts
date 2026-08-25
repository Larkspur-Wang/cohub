import { normalizePermissionScopes } from "@cohub/core/permissions";
import { createDelegatedPromptAuth, type PromptAuthContext, type SubmitSessionPromptContext, type AppSessionPromptAuthContext } from "@cohub/core/sessions";
import type { AppSessionPrincipal } from "./app-sessions.js";
import { resolveAppSessionPublisherScopes, resolveAppSessionViewerGrant, resolveUserSpacePermissions } from "./permissions.js";
import { intersectPermissionScopes } from "@cohub/core/permissions";

/**
 * Prompt auth for an app session acting on one space: scopes are the per-space
 * union of the publisher grant (home space only) and the viewer's live grant
 * intersected with what the viewer can currently do there, resolved
 * server-side so consent state never depends on token contents. The reported
 * viewerScopes are the trimmed set — a role downgrade strips lost scopes here,
 * and delayed executions re-validate again via
 * `resolveViewerGrantScopesAtUseTime` before the worker runs them.
 */
export async function promptAuthContextFromAppSession(appSession: AppSessionPrincipal | null | undefined, spaceId: string): Promise<AppSessionPromptAuthContext | null> {
  if (!appSession) return null;
  const appScopes = await resolveAppSessionPublisherScopes(appSession, spaceId);
  const grant = await resolveAppSessionViewerGrant(appSession, spaceId);
  const viewerScopes = grant
    ? intersectPermissionScopes(grant.scopes, await resolveUserSpacePermissions({ uuid: appSession.userUuid }, spaceId))
    : [];
  const scopes = normalizePermissionScopes([...appScopes, ...viewerScopes]);
  if (scopes.length === 0) return null;
  return {
    type: "app_session",
    appId: appSession.appId,
    spaceId,
    scopes,
    appScopes,
    viewerScopes,
    exp: appSession.exp,
    appViewerGrantId: grant?.grantId ?? null,
  };
}

export async function delegatedPromptAuthFromAppSession(appSession: AppSessionPrincipal | null | undefined, spaceId: string, actorUserId: string) {
  const auth = await promptAuthContextFromAppSession(appSession, spaceId);
  if (!auth) return null;
  return createDelegatedPromptAuth({
    source: "app_session",
    actorUserId,
    appId: auth.appId,
    spaceId: auth.spaceId,
    scopes: auth.scopes,
    appScopes: auth.appScopes,
    viewerScopes: auth.viewerScopes,
    appViewerGrantId: auth.appViewerGrantId ?? null,
    exp: auth.exp,
  });
}

export function mergePromptContextAuth<T extends SubmitSessionPromptContext | null | undefined>(context: T, auth: PromptAuthContext | null): SubmitSessionPromptContext | null {
  if (!context) return auth ? { kind: "public_api", auth } : null;
  if (context.kind === "public_api" || context.kind === "websocket" || context.kind === "scheduled_task" || context.kind === "background_bash_task") {
    return { ...context, auth: auth ?? null };
  }
  return context;
}
