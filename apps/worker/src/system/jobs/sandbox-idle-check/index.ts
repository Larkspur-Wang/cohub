import { DelayedError, type Job } from "bullmq";
import {
  createSandboxLifecycleController,
  resolveSandboxIdleCheckReschedule,
  SANDBOX_IDLE_CHECK_JOB,
  type SandboxIdleCheckJobData,
} from "@cohub/sandbox-controller";
import { createLogger } from "@cohub/infra/logging";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { sandboxInfra } from "../../sandbox-infra.js";

const logger = createLogger({ serviceName: "cohub-worker" });
const controller = createSandboxLifecycleController({
  db,
  redis: redisCommandClient,
  infra: sandboxInfra,
});

registerSystemJob(SANDBOX_IDLE_CHECK_JOB, async (job: Job<SandboxIdleCheckJobData>) => {
  const spaceId = job.data?.spaceId;
  if (!spaceId) throw new Error("sandbox idle check job missing spaceId");

  // checkIdleSandbox re-reads before stop. For not_due we re-check once more
  // right before moveToDelayed so concurrent recover/activity can extend dueAt.
  let result = await controller.checkIdleSandbox({ spaceId });
  let reschedule = resolveSandboxIdleCheckReschedule(result);

  if (reschedule.action === "delay") {
    result = await controller.checkIdleSandbox({ spaceId });
    reschedule = resolveSandboxIdleCheckReschedule(result);
  }

  if (reschedule.action === "delay") {
    if (!job.token) {
      throw new Error(`sandbox idle check missing job token spaceId=${spaceId}`);
    }
    await job.moveToDelayed(reschedule.dueAt.getTime(), job.token);
    logger.info(
      "[SandboxIdleCheck] delayed",
      JSON.stringify({ spaceId, dueAt: reschedule.dueAt.toISOString(), result }),
    );
    throw new DelayedError();
  }

  logger.info("[SandboxIdleCheck] completed", JSON.stringify(result));
  return result as Record<string, unknown>;
});
