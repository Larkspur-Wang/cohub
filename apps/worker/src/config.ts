export interface WorkerConfig {
  bullmqRedisUrl: string;
  databaseUrl: string;
  internalApiBaseUrl: string;
  workerSecret: string;
  env: "dev" | "prod";
}

const env = (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod";

export const config: WorkerConfig = {
  bullmqRedisUrl: process.env.BULLMQ_REDIS_URL ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  internalApiBaseUrl: process.env.INTERNAL_API_BASE_URL ?? "http://localhost:8787",
  workerSecret: process.env.WORKER_SECRET ?? "",
  env,
};

export const assertRequiredConfig = () => {
  if (!config.bullmqRedisUrl) throw new Error("Missing required env: BULLMQ_REDIS_URL");
  if (!config.databaseUrl) throw new Error("Missing required env: DATABASE_URL");
  if (!config.internalApiBaseUrl) throw new Error("Missing required env: INTERNAL_API_BASE_URL");
  if (!config.workerSecret) throw new Error("Missing required env: WORKER_SECRET");
};
