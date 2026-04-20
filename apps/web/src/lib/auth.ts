import LogtoClient from "@logto/browser";
import { goto } from "$app/navigation";

const IS_DEV =
  location.hostname.startsWith("dev") || process.env.NODE_ENV === "development";

export const logtoClient = new LogtoClient(
  IS_DEV
    ? {
        endpoint: "https://dev-auth.neta.art/",
        appId: "vpikk7sl9zwvefiptowtn",
        scopes: ["openid", "offline_access", "profile", "email"],
        resources: ["https://api.talesofai"],
      }
    : {
        endpoint: "https://auth.neta.art/",
        appId: "16ai0wao2mud3xqkbzqo0",
        scopes: ["openid", "offline_access", "profile", "email"],
        resources: ["https://api.talesofai"],
      },
);

export const AUTH_TOKEN_STORAGE_KEY = "cohub_token";

export const getAuthToken = async (): Promise<string | null> => {
  try {
    if (!(await logtoClient.isAuthenticated())) return null;
    return await logtoClient.getAccessToken("https://api.talesofai");
  } catch (error) {
    // Refresh token expired or invalidated — the auth state is broken.
    // Clean up and redirect to re-authenticate.
    console.warn("[auth] Token refresh failed, signing out:", error);
    await handleTokenRefreshFailure();
    return null;
  }
};

const handleTokenRefreshFailure = async () => {
  clearAuthToken();
  try {
    await logtoClient.clearAllTokens();
  } catch {
    // Ignore cleanup failures
  }
  if (typeof window !== "undefined") {
    void goto("/");
  }
};

export const setAuthToken = (token: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
};

export const clearAuthToken = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export const ensureAuth = async (options?: { redirectPath?: string }) => {
  const isAuthenticated = await logtoClient.isAuthenticated();
  if (!isAuthenticated) {
    // const searchParams = new URLSearchParams();
    // searchParams.set("redirect_path", options?.redirectPath ?? "");
    // const callback = `${window.location.origin}/callback?${searchParams.toString()}`;
    await logtoClient.signIn({
      redirectUri: `${window.location.origin}/callback`,
    });
  }
  return isAuthenticated;
};
