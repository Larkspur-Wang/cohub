import { normalizePermissionScopes } from "@cohub/core/permissions";
import { createDelegatedPromptAuth, type PromptAuthContext, type SubmitSessionPromptContext, type WorkSessionPromptAuthContext } from "@cohub/core/sessions";
import type { WorkSessionPrincipal } from "./work-sessions.js";

export function promptAuthContextFromWorkSession(workSession: WorkSessionPrincipal | null | undefined, spaceId: string): WorkSessionPromptAuthContext | null {
  if (!workSession || workSession.spaceId !== spaceId) return null;
  return {
    type: "work_session",
    workId: workSession.workId,
    spaceId: workSession.spaceId,
    scopes: normalizePermissionScopes(workSession.scopes),
    workScopes: normalizePermissionScopes(workSession.workScopes),
    viewerScopes: normalizePermissionScopes(workSession.viewerScopes),
    exp: workSession.exp,
    workViewerGrantId: workSession.workViewerGrantId ?? null,
  };
}

export function delegatedPromptAuthFromWorkSession(workSession: WorkSessionPrincipal | null | undefined, spaceId: string, actorUserId: string) {
  const auth = promptAuthContextFromWorkSession(workSession, spaceId);
  if (!auth) return null;
  return createDelegatedPromptAuth({
    source: "work_session",
    actorUserId,
    workId: auth.workId,
    spaceId: auth.spaceId,
    scopes: auth.scopes,
    workScopes: auth.workScopes,
    viewerScopes: auth.viewerScopes,
    workViewerGrantId: auth.workViewerGrantId ?? null,
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
