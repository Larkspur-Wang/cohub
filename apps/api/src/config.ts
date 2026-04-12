export type AppConfig = {
  authBaseUrl: string;
  giteaBaseUrl: string;
  giteaToken?: string;
  webOrigin?: string;
  redisUrl: string;
  litellmApiKey?: string;
  env: "dev" | "prod";
  giteaManagedEmailDomain: string;
  appEncryptionKey: string;
  sandboxRuntimeImage: string;
  bullmqRedisUrl: string;
  workerSecret: string;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/$/, "");

const getSessionsNamespace = (env: string): string => {
  return env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";
};

const getDefaultSandboxRuntimeImage = (env: "dev" | "prod") => {
  return env === "prod"
    ? "git.talesofai.com/talesofai/cohub-agent:v20260325"
    : "git.talesofai.com/talesofai/cohub-agent:latest";
};

const env = (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod";

export const config: AppConfig = {
  workerSecret: process.env.WORKER_SECRET ?? "",
  authBaseUrl: normalizeBaseUrl(process.env.AUTH_BASE_URL ?? ""),
  giteaBaseUrl: normalizeBaseUrl(process.env.GITEA_BASE_URL ?? ""),
  giteaToken: process.env.GITEA_TOKEN,
  webOrigin: process.env.WEB_ORIGIN,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  litellmApiKey: process.env.LITELLM_API_KEY,
  env,
  giteaManagedEmailDomain: process.env.GITEA_MANAGED_EMAIL_DOMAIN ?? "cohub.local",
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
  sandboxRuntimeImage:
    process.env.SANDBOX_RUNTIME_IMAGE ?? getDefaultSandboxRuntimeImage(env),
  bullmqRedisUrl:
    process.env.BULLMQ_REDIS_URL ?? "",
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
  if (!config.appEncryptionKey) {
    throw new Error("Missing required env: APP_ENCRYPTION_KEY");
  }
  if (!config.workerSecret) {
    throw new Error("Missing required env: WORKER_SECRET");
  }
  if (!config.bullmqRedisUrl) {
    throw new Error("Missing required env: BULLMQ_REDIS_URL");
  }
};
