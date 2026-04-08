import LogtoClient from "@logto/browser";

const IS_DEV =
  location.hostname.startsWith("dev") || process.env.NODE_ENV === "development";

export const logtoClient = new LogtoClient(
  IS_DEV
    ? {
        endpoint: "https://dev-auth.neta.art/",
        appId: "vpikk7sl9zwvefiptowtn",
        scopes: ["profile", "email", "offline_access"],
        resources: ["https://dev.api.talesofai.com"],
      }
    : {
        endpoint: "https://auth.neta.art/",
        appId: "16ai0wao2mud3xqkbzqo0",
        scopes: ["profile", "email", "offline_access"],
        resources: ["https://api.talesofai.com"],
      },
);

export const AUTH_TOKEN_STORAGE_KEY = "cohub_token";

export const getAuthToken = async () => {
  if (!(await logtoClient.isAuthenticated())) return null;
  return await logtoClient.getAccessToken(
    IS_DEV ? "https://dev.api.talesofai.com" : "https://api.talesofai.com",
  );
};

export const setAuthToken = (token: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
};

export const clearAuthToken = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

export const ensureAuth = async (redirectPath?: string) => {
  const isAuthenticated = await logtoClient.isAuthenticated();
  if (!isAuthenticated) {
    const callback = redirectPath
      ? `${window.location.origin}${redirectPath}`
      : `${window.location.origin}/callback`;
    await logtoClient.signIn(callback);
  }
  return isAuthenticated;
};
