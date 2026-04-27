export interface WorkerConfig {
  bullmqRedisUrl: string;
  databaseUrl: string;
  internalApiBaseUrl: string;
  giteaBaseUrl: string;
  workerSecret: string;
  appEncryptionKey: string;
  spaceStorageRoot: string;
  spaceStorageSubpath: string;
  platformSpaceId: string;
  env: "dev" | "prod";
}

const env = (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod";

export const config: WorkerConfig = {
  bullmqRedisUrl: process.env.BULLMQ_REDIS_URL ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  internalApiBaseUrl: process.env.INTERNAL_API_BASE_URL ?? "http://localhost:8787",
  giteaBaseUrl: process.env.GITEA_BASE_URL ?? "",
  workerSecret: process.env.WORKER_SECRET ?? "",
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
  spaceStorageRoot: process.env.SPACE_STORAGE_ROOT ?? "",
  spaceStorageSubpath: process.env.SPACE_STORAGE_SUBPATH ?? (env === "prod" ? "cohub-prod" : "cohub-dev"),
  platformSpaceId: process.env.PLATFORM_SPACE_ID ?? "",
  env,
};

export const assertRequiredConfig = () => {
  if (!config.bullmqRedisUrl) throw new Error("Missing required env: BULLMQ_REDIS_URL");
  if (!config.databaseUrl) throw new Error("Missing required env: DATABASE_URL");
  if (!config.internalApiBaseUrl) throw new Error("Missing required env: INTERNAL_API_BASE_URL");
  if (!config.giteaBaseUrl) throw new Error("Missing required env: GITEA_BASE_URL");
  if (!config.workerSecret) throw new Error("Missing required env: WORKER_SECRET");
  if (!config.appEncryptionKey) throw new Error("Missing required env: APP_ENCRYPTION_KEY");
  if (!config.spaceStorageRoot) throw new Error("Missing required env: SPACE_STORAGE_ROOT");
};
