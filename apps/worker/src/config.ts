export interface WorkerConfig {
  redisUrl: string;
  databaseUrl: string;
  internalApiBaseUrl: string;
  workerSecret: string;
  env: "dev" | "prod";
}

const env = (process.env.ENV === "prod" ? "prod" : "dev") as "dev" | "prod";

export const config: WorkerConfig = {
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  databaseUrl: process.env.DATABASE_URL ?? "",
  internalApiBaseUrl: process.env.INTERNAL_API_BASE_URL ?? "http://localhost:8787",
  workerSecret: process.env.WORKER_SECRET ?? "",
  env,
};

export const assertRequiredConfig = () => {
  if (!config.databaseUrl) throw new Error("Missing required env: DATABASE_URL");
  if (!config.redisUrl) throw new Error("Missing required env: REDIS_URL");
  if (!config.internalApiBaseUrl) throw new Error("Missing required env: INTERNAL_API_BASE_URL");
  if (!config.workerSecret) throw new Error("Missing required env: WORKER_SECRET");
};
