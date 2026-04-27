import type { Context } from "hono";

import { config } from "./config.js";
import { verifyExecutionGrant, type ExecutionGrantPayload } from "./execution-grants.js";

const parseBearer = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
};

export const getTokenFromRequest = (c: Context) => {
  return parseBearer(c.req.header("authorization"));
};

export type AuthUserProfile = {
  id?: number;
  uuid?: string;
  nick_name?: string;
  phone_num?: string;
  avatar_url?: string;
  [key: string]: unknown;
};

export type ExecutionAuthPrincipal = {
  type: "execution";
  actorUserId: string | null;
  spaceId: string;
  sessionId: string | null;
  source: string;
  expiresAt: number;
};

export const fetchAuthUser = async (token: string) => {
  const response = await fetch(`${config.authBaseUrl}/v1/user/`, {
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth service error: ${response.status} ${text}`);
  }

  return (await response.json()) as AuthUserProfile;
};

export const consumeExecutionAuthFromToken = async (token: string): Promise<ExecutionAuthPrincipal | null> => {
  const grant = await verifyExecutionGrant(token);
  if (!grant) return null;
  return toExecutionAuthPrincipal(grant);
};

function toExecutionAuthPrincipal(grant: ExecutionGrantPayload): ExecutionAuthPrincipal {
  return {
    type: "execution",
    actorUserId: grant.actorUserId,
    spaceId: grant.spaceId,
    sessionId: grant.sessionId,
    source: grant.source,
    expiresAt: grant.exp * 1000,
  };
}
