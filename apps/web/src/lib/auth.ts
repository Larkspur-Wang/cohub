export const AUTH_TOKEN_STORAGE_KEY = "cohub_token";

export const getAuthToken = () => {
  if (typeof localStorage === "undefined") return null;
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)?.trim();
  return token || null;
};

export const setAuthToken = (token: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
};

export const clearAuthToken = () => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};
