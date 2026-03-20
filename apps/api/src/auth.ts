import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { config } from "./config.js";

const TOKEN_COOKIE_NAME = "neta-token";

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
  const tokenFromHeader = c.req.header("neta-token");
  if (tokenFromHeader) {
    return tokenFromHeader;
  }

  const tokenFromBearer = parseBearer(c.req.header("authorization"));
  if (tokenFromBearer) {
    return tokenFromBearer;
  }

  return getCookie(c, TOKEN_COOKIE_NAME) ?? null;
};

export const setTokenCookie = (c: Context, token: string) => {
  setCookie(c, TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: c.req.url.startsWith("https://"),
  });
};

export const clearTokenCookie = (c: Context) => {
  deleteCookie(c, TOKEN_COOKIE_NAME, {
    path: "/",
  });
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
