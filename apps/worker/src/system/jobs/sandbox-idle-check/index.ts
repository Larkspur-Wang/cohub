import { createSandboxLifecycleController, SANDBOX_IDLE_CHECK_JOB } from "@cohub/sandbox-controller";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { enqueueSandboxIdleCheckAt } from "../../sandbox-idle-check-queue.js";
import { sandboxInfra } from "../../sandbox-infra.js";
import { registerSystemJob } from "../../registry.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-worker" });
const controller = createSandboxLifecycleController({
  db,
  redis: redisCommandClient,
  infra: sandboxInfra,
});

registerSystemJob(SANDBOX_IDLE_CHECK_JOB, async (job) => {
  const spaceId = (job.data as { spaceId?: string } | undefined)?.spaceId;
  if (!spaceId) throw new Error("sandbox idle check job missing spaceId");

  const result = await controller.checkIdleSandbox({ spaceId });
  if (result.ok && "skipped" in result && result.reason === "not_due" && result.dueAt) {
    await enqueueSandboxIdleCheckAt(spaceId, new Date(result.dueAt));
  }

  logger.info("[SandboxIdleCheck] completed", JSON.stringify(result));
  return result;
});
