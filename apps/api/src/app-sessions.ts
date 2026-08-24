import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { normalizePermissionScopes, scopeListHasPermission, type Permission } from "@cohub/core/permissions";

export type AppSessionPayload = {
  typ: "app_session";
  userUuid: string;
  appId: string;
  spaceId: string;
  appScopes: Permission[];
  /** @deprecated Legacy Work clients read the publisher scopes under this name. */
  workScopes: Permission[];
  viewerScopes: Permission[];
  scopes: Permission[];
  appViewerGrantId?: string;
  iat: number;
  exp: number;
};

export type AppSessionPrincipal = AppSessionPayload & { type: "app_session" };

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const fromBase64urlJson = <T>(value: string): T => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;

const signingSecret = () => {
  if (!config.appEncryptionKey) throw new Error("Missing APP_ENCRYPTION_KEY for app session tokens");
  return config.appEncryptionKey;
};

const signInput = (input: string) => createHmac("sha256", signingSecret()).update(input).digest();

export const APP_SESSION_TTL_SECONDS = 60 * 60;

export function createAppSessionToken(input: {
  userUuid: string;
  appId: string;
  spaceId: string;
  appScopes: Permission[];
  viewerScopes?: Permission[];
  appViewerGrantId?: string;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const viewerScopes = normalizePermissionScopes(input.viewerScopes ?? []);
  const appScopes = normalizePermissionScopes(input.appScopes);
  const scopes = normalizePermissionScopes([...appScopes, ...viewerScopes]);
  const payload: AppSessionPayload = {
    typ: "app_session",
    userUuid: input.userUuid,
    appId: input.appId,
    spaceId: input.spaceId,
    appScopes,
    // Keep the old claim name for published Work clients that inspect JWTs.
    workScopes: appScopes,
    viewerScopes,
    scopes,
    appViewerGrantId: input.appViewerGrantId,
    iat: now,
    exp: now + (input.ttlSeconds ?? APP_SESSION_TTL_SECONDS),
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = base64url(signInput(signingInput));
  return `${signingInput}.${signature}`;
}

export function verifyAppSessionToken(token: string): AppSessionPrincipal | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = signInput(signingInput);
  const actual = Buffer.from(signaturePart, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload: AppSessionPayload;
  try {
    payload = fromBase64urlJson<AppSessionPayload>(payloadPart);
  } catch {
    return null;
  }
  if (payload.typ !== "app_session") return null;
  if (!payload.userUuid || !payload.appId || !payload.spaceId) return null;
  if (!Array.isArray(payload.scopes) || !Array.isArray(payload.appScopes) || !Array.isArray(payload.viewerScopes)) return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return {
    ...payload,
    scopes: normalizePermissionScopes(payload.scopes),
    appScopes: normalizePermissionScopes(payload.appScopes),
    workScopes: normalizePermissionScopes(payload.workScopes ?? payload.appScopes),
    viewerScopes: normalizePermissionScopes(payload.viewerScopes),
    type: "app_session",
  };
}

export const hasAppSessionPermission = (principal: AppSessionPrincipal, permission: Permission, spaceId: string) => {
  if (principal.spaceId !== spaceId) return false;
  return scopeListHasPermission(normalizePermissionScopes(principal.scopes), permission);
};
