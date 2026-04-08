import LogtoClient from "@logto/browser";

const IS_DEV =
  location.hostname.startsWith("dev") || process.env.NODE_ENV === "development";

export const logtoClient = new LogtoClient(
  IS_DEV
    ? {
        endpoint: "https://dev-auth.talesofai.com/",
        appId: "u2l5j2mb1lsyyvcssa55e",
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

export const getAuthToken = async () => {
  if (!(await logtoClient.isAuthenticated())) return null;
  return await logtoClient.getAccessToken("https://api.talesofai");
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
