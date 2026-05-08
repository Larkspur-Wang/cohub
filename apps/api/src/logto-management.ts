import { config } from "./config.js";

export type LogtoUser = Record<string, unknown>;

type ManagementToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: ManagementToken | null = null;

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
};

export async function getLogtoManagementToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.accessToken;

  const appId = getRequiredEnv("LOGTO_M2M_APP_ID");
  const appSecret = getRequiredEnv("LOGTO_M2M_APP_SECRET");
  const resource = process.env.LOGTO_MANAGEMENT_API_RESOURCE?.trim() || `${config.logtoEndpoint}/api`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    resource,
    scope: "read:users update:users",
  });

  const response = await fetch(`${config.logtoEndpoint}/oidc/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Logto management token request failed: ${response.status} ${text}`);
  }

  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Logto management token response missing access_token");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  if (typeof data.expires_in !== "number") {
    console.warn("[logto] Unexpected expires_in type, defaulting to 3600s:", data.expires_in);
  }
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return cachedToken.accessToken;
}

async function logtoManagementRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getLogtoManagementToken();
  const baseUrl = `${config.logtoEndpoint}/api`;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Logto management request failed: ${response.status} ${text}`);
  }

  if (response.status === 204) return null as T;
  return await response.json() as T;
}

export function getLogtoUser(logtoUserId: string) {
  return logtoManagementRequest<LogtoUser>(`/users/${encodeURIComponent(logtoUserId)}`);
}

export async function updateLogtoUserProfile(logtoUserId: string, input: { displayName?: string; avatarUrl?: string | null }) {
  const profile: Record<string, unknown> = {};
  if (input.displayName !== undefined) profile.name = input.displayName;
  if (input.avatarUrl !== undefined) profile.avatar = input.avatarUrl;

  await logtoManagementRequest<unknown>(`/users/${encodeURIComponent(logtoUserId)}/profile`, {
    method: "PATCH",
    body: JSON.stringify(profile),
  });
}
