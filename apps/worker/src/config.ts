export interface WorkerConfig {
  redisUrl: string;
  bullmqRedisUrl: string;
  databaseUrl: string;
  giteaBaseUrl: string;
  workerSecret: string;
  executionGrantSigningKey: string;
  spaceStorageRoot: string;
  spaceStorageSubpath: string;
  platformConfigRoot: string;
  platformSpaceId: string;
  turnObjectS3Endpoint?: string;
  turnObjectS3Region: string;
  turnObjectS3Bucket?: string;
  turnObjectCdnBaseUrl: string;
  turnObjectS3AccessKeyId?: string;
  turnObjectS3SecretAccessKey?: string;
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
  giteaBaseUrl: process.env.GITEA_BASE_URL ?? "",
  workerSecret: process.env.WORKER_SECRET ?? "",
  executionGrantSigningKey: process.env.EXECUTION_GRANT_SIGNING_KEY ?? process.env.APP_ENCRYPTION_KEY ?? "",
  spaceStorageRoot: process.env.SPACE_STORAGE_ROOT ?? "",
  spaceStorageSubpath: process.env.SPACE_STORAGE_SUBPATH ?? (env === "prod" ? "cohub-prod" : "cohub-dev"),
  platformConfigRoot: process.env.PLATFORM_CONFIG_ROOT ?? "/configs",
  platformSpaceId: process.env.PLATFORM_SPACE_ID ?? "",
  turnObjectS3Endpoint: process.env.TURN_OBJECT_S3_ENDPOINT ?? "https://oss-us-west-1-internal.aliyuncs.com",
  turnObjectS3Region: process.env.TURN_OBJECT_S3_REGION ?? "us-west-1",
  turnObjectS3Bucket: process.env.TURN_OBJECT_S3_BUCKET ?? "cohub-sessions",
  turnObjectCdnBaseUrl: (process.env.TURN_OBJECT_CDN_BASE_URL ?? "https://sessions.cohub.run").replace(/\/+$/, ""),
  turnObjectS3AccessKeyId: process.env.TURN_OBJECT_S3_ACCESS_KEY_ID,
  turnObjectS3SecretAccessKey: process.env.TURN_OBJECT_S3_SECRET_ACCESS_KEY,
  env,
};

export const assertRequiredConfig = () => {
  assertRedisUrl(config.redisUrl, "REDIS_URL");
  assertRedisUrl(config.bullmqRedisUrl, "BULLMQ_REDIS_URL");
  if (!config.databaseUrl) throw new Error("Missing required env: DATABASE_URL");
  if (!config.giteaBaseUrl) throw new Error("Missing required env: GITEA_BASE_URL");
  if (!config.workerSecret) throw new Error("Missing required env: WORKER_SECRET");
  if (!config.executionGrantSigningKey) throw new Error("Missing required env: EXECUTION_GRANT_SIGNING_KEY (or APP_ENCRYPTION_KEY fallback)");
  if (!config.spaceStorageRoot) throw new Error("Missing required env: SPACE_STORAGE_ROOT");
};
