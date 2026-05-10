import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import { dispatchRealtimeEventToUsers, getReadableUserIdsForSpace } from "./channels.js";

export async function dispatchSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  const readableUserIds = await getReadableUserIdsForSpace(spaceId);
  await dispatchRealtimeEventToUsers({
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
  });
}
