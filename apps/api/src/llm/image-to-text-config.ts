import { createModelTasksConfigLoader } from "@cohub/infra/config-runtime/model-tasks";
import { config } from "../config.js";
import { redisCommandClient } from "../redis.js";

const loadModelTasksConfig = createModelTasksConfigLoader({
  platformConfigRoot: config.platformConfigRoot,
  redis: redisCommandClient,
});

export const loadImageToTextConfig = async (userId?: string | null) =>
  (await loadModelTasksConfig(userId)).imageToText ?? null;
