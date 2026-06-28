import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { REALTIME_OUTBOUND_CHANNEL } from "@cohub/protocol/realtime";
import { redisCommandClient } from "./redis.js";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-worker" });

export async function publishSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    await Promise.all([
      redisCommandClient.publish(
        REALTIME_OUTBOUND_CHANNEL,
        JSON.stringify({
          id: randomUUID(),
          timestamp: Date.now(),
          domain: "space",
          type: "space.fs.changed",
          spaceId,
          sessionId: null,
          payload,
        }),
      ),
      enqueueFsCdnWarmForChanges(spaceId, payload.changes).catch((error) => {
        logger.error("[SpaceFS] Failed to enqueue CDN prewarm:", error);
      }),
    ]);
  } catch (error) {
    logger.warn(`[SpaceEvents] Failed to publish space fs changed for ${spaceId}:`, error);
    throw error;
  }
}
