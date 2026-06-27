import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { dispatchRealtimeEvent } from "./channels.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-api" });
export async function dispatchSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  await Promise.all([
    dispatchRealtimeEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.fs.changed",
      spaceId,
      sessionId: null,
      payload,
    }),
    enqueueFsCdnWarmForChanges(spaceId, payload.changes).catch((error) => {
      logger.error("[SpaceFS] Failed to enqueue CDN prewarm:", error);
    }),
  ]);
}
