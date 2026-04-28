import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import { dispatchRealtimeEventToUsers, getReadableUserIdsForSpace } from "./channels.js";

export type SpaceFsChangedStreamEvent = {
  type: "space.fs.changed";
  spaceId: string;
  payload: SpaceFsChangedPayload;
  trace?: Record<string, unknown>;
};

export async function dispatchSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  let readableUserIds: string[];
  try {
    readableUserIds = await getReadableUserIdsForSpace(spaceId);
  } catch (error) {
    console.warn(`[SpaceEvents] Failed to resolve readable users for ${spaceId}:`, error);
    throw error;
  }
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
