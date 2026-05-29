import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { recomputeSpaceWsUsers } from "@cohub/core/spaces";
import { redisCommandClient } from "./redis.js";
import { db } from "./db.js";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-worker" });
const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";

export async function publishSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    const targetUserIds = await recomputeSpaceWsUsers({ db, redis: redisCommandClient, spaceId });
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
          payload: {
            ...payload,
            targetUserIds,
          },
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
