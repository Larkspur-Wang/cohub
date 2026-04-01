import type { Context } from "hono";

import { config } from "./config.js";

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

export const fetchAuthUser = async (token: string) => {
  const response = await fetch(`${config.authBaseUrl}/v1/user/`, {
    headers: {
      "x-token": token,
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
