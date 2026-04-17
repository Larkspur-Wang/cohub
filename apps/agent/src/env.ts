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

export const GLOBAL_CONFIG_REPO = "https://gitea.cohub.run/global/configs.git";

export const EnvSchema = z.object({
  SPACE_ID: z.string().uuid().default("00000000-0000-0000-0000-000000000001"),
  REDIS_URL: redisUrlSchema.default("redis://localhost:6379"),
  SPACE_DIR: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/"), {
      message: "SPACE_DIR must be an absolute path",
    })
    .default("/workspace"),
  SESSIONS_DIR: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/"), {
      message: "SESSIONS_DIR must be an absolute path",
    })
    .default("/sessions"),
  ENV: z.enum(["dev", "prod"]).default("dev"),
  SPACE_REPO_URL: z.string().optional(),
  SPACE_GIT_USERNAME: z.string().optional(),
  SPACE_GIT_EMAIL: z.string().optional(),
  PUBLIC_URL_PREFIX: z.string().optional(),
  AGENT_VERSION: z.string().optional(),
  WORKER_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;
export const env = EnvSchema.parse(process.env);
