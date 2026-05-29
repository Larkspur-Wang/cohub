import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { dispatchRealtimeEventToUsers, getReadableUserIdsForSpace } from "./channels.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-api" });
export async function dispatchSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  const readableUserIds = await getReadableUserIdsForSpace(spaceId);
  await Promise.all([
    dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.fs.changed",
      spaceId,
      sessionId: null,
      payload: {
        ...payload,
        targetUserIds: readableUserIds,
      },
    }),
    enqueueFsCdnWarmForChanges(spaceId, payload.changes).catch((error) => {
      logger.error("[SpaceFS] Failed to enqueue CDN prewarm:", error);
    }),
  ]);
}
