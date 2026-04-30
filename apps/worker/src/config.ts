export interface WorkerConfig {
  redisUrl: string;
  bullmqRedisUrl: string;
  databaseUrl: string;
  internalApiBaseUrl: string;
  giteaBaseUrl: string;
  workerSecret: string;
  appEncryptionKey: string;
  spaceStorageRoot: string;
  spaceStorageSubpath: string;
  platformConfigRoot: string;
  platformSpaceId: string;
  env: "dev" | "prod";
}

const env = (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod";

const assertRedisUrl = (value: string, envName: string) => {
  if (!value) throw new Error(`Missing required env: ${envName}`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error(`Invalid ${envName}: must be a redis:// or rediss:// URL`);
  }
};

export const config: WorkerConfig = {
  redisUrl: process.env.REDIS_URL ?? "",
  bullmqRedisUrl: process.env.BULLMQ_REDIS_URL ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  internalApiBaseUrl: process.env.INTERNAL_API_BASE_URL ?? "http://localhost:8787",
  giteaBaseUrl: process.env.GITEA_BASE_URL ?? "",
  workerSecret: process.env.WORKER_SECRET ?? "",
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
  spaceStorageRoot: process.env.SPACE_STORAGE_ROOT ?? "",
  spaceStorageSubpath: process.env.SPACE_STORAGE_SUBPATH ?? (env === "prod" ? "cohub-prod" : "cohub-dev"),
  platformConfigRoot: process.env.PLATFORM_CONFIG_ROOT ?? "/configs",
  platformSpaceId: process.env.PLATFORM_SPACE_ID ?? "",
  env,
};

export const assertRequiredConfig = () => {
  assertRedisUrl(config.redisUrl, "REDIS_URL");
  assertRedisUrl(config.bullmqRedisUrl, "BULLMQ_REDIS_URL");
  if (!config.databaseUrl) throw new Error("Missing required env: DATABASE_URL");
  if (!config.internalApiBaseUrl) throw new Error("Missing required env: INTERNAL_API_BASE_URL");
  if (!config.giteaBaseUrl) throw new Error("Missing required env: GITEA_BASE_URL");
  if (!config.workerSecret) throw new Error("Missing required env: WORKER_SECRET");
  if (!config.appEncryptionKey) throw new Error("Missing required env: APP_ENCRYPTION_KEY");
  if (!config.spaceStorageRoot) throw new Error("Missing required env: SPACE_STORAGE_ROOT");
};
