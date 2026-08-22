import { normalizePermissionScopes } from "@cohub/core/permissions";
import { createDelegatedPromptAuth, type PromptAuthContext, type SubmitSessionPromptContext, type AppSessionPromptAuthContext } from "@cohub/core/sessions";
import type { AppSessionPrincipal } from "./app-sessions.js";

export function promptAuthContextFromAppSession(appSession: AppSessionPrincipal | null | undefined, spaceId: string): AppSessionPromptAuthContext | null {
  if (!appSession || appSession.spaceId !== spaceId) return null;
  return {
    type: "app_session",
    appId: appSession.appId,
    spaceId: appSession.spaceId,
    scopes: normalizePermissionScopes(appSession.scopes),
    appScopes: normalizePermissionScopes(appSession.appScopes),
    viewerScopes: normalizePermissionScopes(appSession.viewerScopes),
    exp: appSession.exp,
    appViewerGrantId: appSession.appViewerGrantId ?? null,
  };
}

export function delegatedPromptAuthFromAppSession(appSession: AppSessionPrincipal | null | undefined, spaceId: string, actorUserId: string) {
  const auth = promptAuthContextFromAppSession(appSession, spaceId);
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
