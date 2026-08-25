import { createModelTasksConfigLoader } from "@cohub/infra/config-runtime/model-tasks";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";

export const loadModelTasksConfig = createModelTasksConfigLoader({
  platformConfigRoot: config.platformConfigRoot,
  redis: redisCommandClient,
});
