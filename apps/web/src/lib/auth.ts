import LogtoClient from "@logto/browser";

export const logtoClient = new LogtoClient({
  endpoint: "https://auth.talesofai.com/",
  appId: "16ai0wao2mud3xqkbzqo0",
  scopes: ["profile", "email", "offline_access"],
  resources: ["https://api.talesofai.com"],
});

export const AUTH_TOKEN_STORAGE_KEY = "cohub_token";

export const getAuthToken = async () => {
  if (!(await logtoClient.isAuthenticated())) return null;
  return await logtoClient.getAccessToken("https://api.talesofai.com");
};

export const setAuthToken = (token: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
};

export const clearAuthToken = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};
