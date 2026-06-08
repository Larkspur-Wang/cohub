import { resolveLogtoEndpoint } from "@cohub/identity";

export type AppConfig = {
  logtoEndpoint: string;
  webOrigin?: string;
  redisUrl: string;
  litellmApiKey?: string;
  talesofaiBillingBaseUrl?: string;
  talesofaiBillingBusinessKey?: string;
  talesofaiBillingAdminApiKey?: string;
  env: "dev" | "prod";
  appEncryptionKey: string;
  sandboxImage: string;
  bullmqRedisUrl: string;
  workerSecret: string;
  spaceStorageRoot: string;
  spaceStoragePvc: string;
  checkpointCachePvc: string;
  spaceSystemRoot: string;
  spaceStorageSubpath: string;
  configsSubpath: string;
  platformConfigRoot: string;
  turnObjectS3Endpoint?: string;
  turnObjectS3PublicEndpoint?: string;
  turnObjectS3Region: string;
  turnObjectS3Bucket?: string;
  turnObjectS3AccessKeyId?: string;
  turnObjectS3SecretAccessKey?: string;
  turnObjectCdnBaseUrl: string;
  publicAssetOssEndpoint?: string;
  publicAssetOssPublicEndpoint?: string;
  publicAssetOssRegion: string;
  publicAssetOssBucket?: string;
  publicAssetOssAccessKeyId?: string;
  publicAssetOssSecretAccessKey?: string;
  publicAssetCdnBaseUrl?: string;
  checkpointAssetOssEndpoint?: string;
  checkpointAssetOssPublicEndpoint?: string;
  checkpointAssetOssRegion: string;
  checkpointAssetOssBucket?: string;
  checkpointAssetOssAccessKeyId?: string;
  checkpointAssetOssSecretAccessKey?: string;
};

const getSessionsNamespace = (env: string): string => {
  return env === "dev" ? "cohub-sessions-dev" : "cohub-sessions";
};

const getDefaultSandboxImage = (env: "dev" | "prod") => {
  return env === "prod"
    ? "git.talesofai.com/talesofai/cohub-sandbox:v20260325"
    : "git.talesofai.com/talesofai/cohub-sandbox:latest";
};

const env = (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod";

export const config: AppConfig = {
  workerSecret: process.env.WORKER_SECRET ?? "",
  logtoEndpoint: resolveLogtoEndpoint({ endpoint: process.env.LOGTO_ENDPOINT, env }),
  webOrigin: process.env.WEB_ORIGIN,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  litellmApiKey: process.env.LITELLM_API_KEY,
  talesofaiBillingBaseUrl: process.env.TALESOFAI_BILLING_BASE_URL?.replace(/\/+$/, ""),
  talesofaiBillingBusinessKey: process.env.TALESOFAI_BILLING_BUSINESS_KEY,
  talesofaiBillingAdminApiKey: process.env.TALESOFAI_BILLING_ADMIN_API_KEY,
  env,
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? "",
  sandboxImage:
    process.env.SANDBOX_IMAGE ?? getDefaultSandboxImage(env),
  bullmqRedisUrl:
    process.env.BULLMQ_REDIS_URL ?? "",
  spaceStorageRoot: process.env.SPACE_STORAGE_ROOT ?? "",
  spaceStoragePvc: process.env.SPACE_STORAGE_PVC ?? "cohub-spaces-pvc",
  checkpointCachePvc: process.env.CHECKPOINT_CACHE_PVC ?? process.env.SPACE_STORAGE_PVC ?? "cohub-spaces-pvc",
  spaceSystemRoot: process.env.SPACE_SYSTEM_ROOT ?? process.env.SPACE_STORAGE_ROOT ?? "",
  spaceStorageSubpath: process.env.SPACE_STORAGE_SUBPATH ?? (env === "prod" ? "cohub-prod" : "cohub-dev"),
  configsSubpath: process.env.CONFIGS_SUBPATH ?? (env === "prod" ? "configs/prod" : "configs/dev"),
  platformConfigRoot: process.env.PLATFORM_CONFIG_ROOT ?? "/configs",
  turnObjectS3Endpoint: process.env.TURN_OBJECT_S3_ENDPOINT ?? "https://oss-us-west-1-internal.aliyuncs.com",
  turnObjectS3PublicEndpoint: process.env.TURN_OBJECT_S3_PUBLIC_ENDPOINT,
  turnObjectS3Region: process.env.TURN_OBJECT_S3_REGION ?? "us-west-1",
  turnObjectS3Bucket: process.env.TURN_OBJECT_S3_BUCKET ?? "cohub-sessions",
  turnObjectS3AccessKeyId: process.env.TURN_OBJECT_S3_ACCESS_KEY_ID,
  turnObjectS3SecretAccessKey: process.env.TURN_OBJECT_S3_SECRET_ACCESS_KEY,
  turnObjectCdnBaseUrl: (process.env.TURN_OBJECT_CDN_BASE_URL ?? "https://sessions.cohub.run").replace(/\/+$/, ""),
  publicAssetOssEndpoint: process.env.PUBLIC_ASSET_OSS_ENDPOINT,
  publicAssetOssPublicEndpoint: process.env.PUBLIC_ASSET_OSS_PUBLIC_ENDPOINT,
  publicAssetOssRegion: process.env.PUBLIC_ASSET_OSS_REGION ?? "us-west-1",
  publicAssetOssBucket: process.env.PUBLIC_ASSET_OSS_BUCKET,
  publicAssetOssAccessKeyId: process.env.PUBLIC_ASSET_OSS_ACCESS_KEY_ID,
  publicAssetOssSecretAccessKey: process.env.PUBLIC_ASSET_OSS_SECRET_ACCESS_KEY,
  publicAssetCdnBaseUrl: process.env.PUBLIC_ASSET_CDN_BASE_URL?.replace(/\/+$/, ""),
  checkpointAssetOssEndpoint: process.env.CHECKPOINT_ASSET_OSS_ENDPOINT ?? process.env.TURN_OBJECT_S3_ENDPOINT ?? "https://oss-us-west-1-internal.aliyuncs.com",
  checkpointAssetOssPublicEndpoint: process.env.CHECKPOINT_ASSET_OSS_PUBLIC_ENDPOINT ?? process.env.TURN_OBJECT_S3_PUBLIC_ENDPOINT,
  checkpointAssetOssRegion: process.env.CHECKPOINT_ASSET_OSS_REGION ?? process.env.TURN_OBJECT_S3_REGION ?? "us-west-1",
  checkpointAssetOssBucket: process.env.CHECKPOINT_ASSET_OSS_BUCKET ?? process.env.TURN_OBJECT_S3_BUCKET,
  checkpointAssetOssAccessKeyId: process.env.CHECKPOINT_ASSET_OSS_ACCESS_KEY_ID ?? process.env.TURN_OBJECT_S3_ACCESS_KEY_ID,
  checkpointAssetOssSecretAccessKey: process.env.CHECKPOINT_ASSET_OSS_SECRET_ACCESS_KEY ?? process.env.TURN_OBJECT_S3_SECRET_ACCESS_KEY,
};

export const sessionsNamespace = getSessionsNamespace(config.env);

export const assertRequiredConfig = () => {
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
