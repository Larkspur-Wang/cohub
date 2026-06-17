import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { normalizePermissionScopes, scopeListHasPermission, type Permission } from "@cohub/core/permissions";

export type WorkSessionPayload = {
  typ: "work_session";
  userUuid: string;
  workId: string;
  spaceId: string;
  workScopes: Permission[];
  viewerScopes: Permission[];
  scopes: Permission[];
  workViewerGrantId?: string;
  iat: number;
  exp: number;
};

export type WorkSessionPrincipal = WorkSessionPayload & { type: "work_session" };

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const fromBase64urlJson = <T>(value: string): T => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;

const signingSecret = () => {
  if (!config.appEncryptionKey) throw new Error("Missing APP_ENCRYPTION_KEY for work session tokens");
  return config.appEncryptionKey;
};

const signInput = (input: string) => createHmac("sha256", signingSecret()).update(input).digest();

export const WORK_SESSION_TTL_SECONDS = 60 * 60;

export function createWorkSessionToken(input: {
  userUuid: string;
  workId: string;
  spaceId: string;
  workScopes: Permission[];
  viewerScopes?: Permission[];
  workViewerGrantId?: string;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const viewerScopes = normalizePermissionScopes(input.viewerScopes ?? []);
  const workScopes = normalizePermissionScopes(input.workScopes);
  const scopes = normalizePermissionScopes([...workScopes, ...viewerScopes]);
  const payload: WorkSessionPayload = {
    typ: "work_session",
    userUuid: input.userUuid,
    workId: input.workId,
    spaceId: input.spaceId,
    workScopes,
    viewerScopes,
    scopes,
    workViewerGrantId: input.workViewerGrantId,
    iat: now,
    exp: now + (input.ttlSeconds ?? WORK_SESSION_TTL_SECONDS),
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = base64url(signInput(signingInput));
  return `${signingInput}.${signature}`;
}

export function verifyWorkSessionToken(token: string): WorkSessionPrincipal | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = signInput(signingInput);
  const actual = Buffer.from(signaturePart, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload: WorkSessionPayload;
  try {
    payload = fromBase64urlJson<WorkSessionPayload>(payloadPart);
  } catch {
    return null;
  }
  if (payload.typ !== "work_session") return null;
  if (!payload.userUuid || !payload.workId || !payload.spaceId) return null;
  if (!Array.isArray(payload.scopes) || !Array.isArray(payload.workScopes) || !Array.isArray(payload.viewerScopes)) return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return {
    ...payload,
    scopes: normalizePermissionScopes(payload.scopes),
    workScopes: normalizePermissionScopes(payload.workScopes),
    viewerScopes: normalizePermissionScopes(payload.viewerScopes),
    type: "work_session",
  };
}

export const hasWorkSessionPermission = (principal: WorkSessionPrincipal, permission: Permission, spaceId: string) => {
  if (principal.spaceId !== spaceId) return false;
  return scopeListHasPermission(normalizePermissionScopes(principal.scopes), permission);
};
