import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { sandboxInfra } from "../../sandbox-infra.js";
import { SANDBOX_IDLE_REAPER_JOB } from "./types.js";

const getLimit = () => Number(process.env.SANDBOX_IDLE_REAPER_LIMIT ?? 50);

const sandboxLifecycle = createSandboxLifecycleController({
  db,
  redis: redisCommandClient,
  infra: sandboxInfra,
});

registerSystemJob(SANDBOX_IDLE_REAPER_JOB, async () => {
  const result = await sandboxLifecycle.reapIdleSandboxes({
    limit: getLimit(),
  });
  console.log("[SandboxReaper] completed", JSON.stringify(result));
  return result;
});
