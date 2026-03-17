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

export const GLOBAL_PI_CONFIG_REPO =
  "https://gitea.netaverses.cc/global/configs.git";

export const EnvSchema = z.object({
  SESSION_ID: z
    .string()
    .regex(/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/, {
      message:
        "SESSION_ID must be 1-63 chars of lowercase letters, numbers, or hyphens",
    })
    .default("dev-session-001"),
  REDIS_URL: redisUrlSchema.default("redis://localhost:6379"),
  WORKSPACE_DIR: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("/"), {
      message: "WORKSPACE_DIR must be an absolute path",
    })
    .default("/workspace"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env = EnvSchema.parse(process.env);
