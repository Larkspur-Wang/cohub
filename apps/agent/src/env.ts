import { z } from "zod";

const redisUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "redis:" || url.protocol === "rediss:";
    } catch {
      return false;
    }
  }, "REDIS_URL must use redis:// or rediss://");

const defaultAgentInstanceId = process.env.HOSTNAME?.trim() || `agent-${process.pid}`;

export const EnvSchema = z.object({
  AGENT_INSTANCE_ID: z.string().min(1).default(defaultAgentInstanceId),
  REDIS_URL: redisUrlSchema.default("redis://localhost:6379"),
  BULLMQ_REDIS_URL: redisUrlSchema.default(process.env.REDIS_URL ?? "redis://localhost:6379"),
  DATABASE_URL: z.string().min(1),
  AGENT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  AGENT_JOB_LOCK_DURATION_MS: z.coerce.number().int().positive().default(120_000),
  AGENT_JOB_LOCK_RENEW_TIME_MS: z.coerce.number().int().positive().default(45_000),
  AGENT_JOB_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  AGENT_JOB_MAX_STALLED_COUNT: z.coerce.number().int().min(0).default(1),
  AGENT_SESSION_LOCK_TTL_MS: z.coerce.number().int().positive().default(120_000),
  AGENT_SESSION_LOCK_RENEW_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_SHUTDOWN_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(35 * 60_000),
  WORKSPACE_ROOT: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/"), {
      message: "WORKSPACE_ROOT must be an absolute path",
    })
    .default("/space-storage"),
  SESSIONS_DIR: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/"), {
      message: "SESSIONS_DIR must be an absolute path",
    })
    .default("/sessions"),
  PLATFORM_CONFIG_ROOT: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/"), {
      message: "PLATFORM_CONFIG_ROOT must be an absolute path",
    })
    .default("/configs"),
  ENV: z.enum(["dev", "prod"]).default("dev"),
  AGENT_VERSION: z.string().optional(),
  WORKER_SECRET: z.string().optional(),
  SESSIONS_NAMESPACE: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;
export const env = EnvSchema.parse(process.env);

export const AGENT_INSTANCE_HEARTBEAT_MS = 5000;
export const SPACE_OWNER_LEASE_MS = 15000;
