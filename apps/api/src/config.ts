export type AppConfig = {
  authBaseUrl: string;
  giteaBaseUrl: string;
  giteaToken?: string;
  webOrigin?: string;
  redisUrl: string;
  litellmApiKey?: string;
  env: "dev" | "prod";
};

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, "");

const getSessionsNamespace = (env: string): string => {
  return env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";
};

export const config: AppConfig = {
  authBaseUrl: normalizeBaseUrl(process.env.AUTH_BASE_URL ?? ""),
  giteaBaseUrl: normalizeBaseUrl(process.env.GITEA_BASE_URL ?? ""),
  giteaToken: process.env.GITEA_TOKEN,
  webOrigin: process.env.WEB_ORIGIN,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  litellmApiKey: process.env.LITELLM_API_KEY,
  env: (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod",
};

export const sessionsNamespace = getSessionsNamespace(config.env);

export const assertRequiredConfig = () => {
  if (!config.giteaBaseUrl) {
    throw new Error("Missing required env: GITEA_BASE_URL");
  }
  if (!config.authBaseUrl) {
    throw new Error("Missing required env: AUTH_BASE_URL");
  }
  if (!config.redisUrl) {
    throw new Error("Missing required env: REDIS_URL");
  }
};
