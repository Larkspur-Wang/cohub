import { config } from "./config.js";
import { createExecutionGrantService } from "@cohub/core/security";

export type { ExecutionGrantPayload } from "@cohub/core/security";

const executionGrantService = createExecutionGrantService({
  signingKey: config.appEncryptionKey,
});

export const verifyExecutionGrant = executionGrantService.verifyExecutionGrant;
