import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePermissionScopes, scopeListHasPermission, type Permission } from "@cohub/core/permissions";
import { config } from "./config.js";

export type PreviewSessionPayload = {
  typ: "preview_session";
  userUuid: string;
  spaceId: string;
  scopes: Permission[];
  iat: number;
  exp: number;
};

export type PreviewSessionPrincipal = PreviewSessionPayload & { type: "preview_session" };

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const fromBase64urlJson = <T>(value: string): T => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;

const signingSecret = () => {
  if (!config.appEncryptionKey) throw new Error("Missing APP_ENCRYPTION_KEY for preview session tokens");
  return config.appEncryptionKey;
};

const signInput = (input: string) => createHmac("sha256", signingSecret()).update(input).digest();

export const PREVIEW_SESSION_TTL_SECONDS = 10 * 60;

export function createPreviewSessionToken(input: {
  userUuid: string;
  spaceId: string;
  scopes?: Permission[];
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const scopes = normalizePermissionScopes(input.scopes ?? ["file.view"]);
  const payload: PreviewSessionPayload = {
    typ: "preview_session",
    userUuid: input.userUuid,
    spaceId: input.spaceId,
    scopes,
    iat: now,
    exp: now + (input.ttlSeconds ?? PREVIEW_SESSION_TTL_SECONDS),
  };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = base64url(signInput(signingInput));
  return `${signingInput}.${signature}`;
}

export function verifyPreviewSessionToken(token: string): PreviewSessionPrincipal | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const signingInput = `${headerPart}.${payloadPart}`;
  let expected: Buffer;
  try {
    expected = signInput(signingInput);
  } catch {
    return null;
  }
  const actual = Buffer.from(signaturePart, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let payload: PreviewSessionPayload;
  try {
    payload = fromBase64urlJson<PreviewSessionPayload>(payloadPart);
  } catch {
    return null;
  }
  if (payload.typ !== "preview_session") return null;
  if (!payload.userUuid || !payload.spaceId || !Array.isArray(payload.scopes)) return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return {
    ...payload,
    scopes: normalizePermissionScopes(payload.scopes),
    type: "preview_session",
  };
}

export const hasPreviewSessionPermission = (principal: PreviewSessionPrincipal, permission: Permission, spaceId: string) => {
  if (principal.spaceId !== spaceId) return false;
  return scopeListHasPermission(normalizePermissionScopes(principal.scopes), permission);
};
