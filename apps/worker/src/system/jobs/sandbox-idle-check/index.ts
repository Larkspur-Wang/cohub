import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { SANDBOX_IDLE_CHECK_JOB } from "./types.js";

const controller = createSandboxLifecycleController({
  db,
  redis: redisCommandClient,
});

registerSystemJob(SANDBOX_IDLE_CHECK_JOB, async (job) => {
  const spaceId = (job.data as { spaceId?: string } | undefined)?.spaceId;
  if (!spaceId) throw new Error("sandbox idle check job missing spaceId");
  const result = await controller.checkIdleSandbox({ spaceId });
  console.log("[SandboxIdleCheck] completed", JSON.stringify(result));
  return result;
});
