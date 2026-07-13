import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { sandboxInfra } from "../../sandbox-infra.js";
import { SANDBOX_IDLE_REAPER_JOB } from "./types.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-worker" });
const getLimit = () => {
  const parsed = Number(process.env.SANDBOX_IDLE_REAPER_LIMIT ?? 50);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.floor(parsed);
};

const sandboxLifecycle = createSandboxLifecycleController({
  db,
  redis: redisCommandClient,
  infra: sandboxInfra,
});

registerSystemJob(SANDBOX_IDLE_REAPER_JOB, async () => {
  const result = await sandboxLifecycle.reapIdleSandboxes({
    limit: getLimit(),
  });
  logger.info("[SandboxReaper] completed", JSON.stringify(result));
  return result;
});
