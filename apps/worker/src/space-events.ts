import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import { redisCommandClient, SPACE_EVENTS_STREAM, STREAM_APPROX, STREAM_MAXLEN } from "./redis.js";

export async function publishSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    await redisCommandClient.xadd(
      SPACE_EVENTS_STREAM,
      "MAXLEN",
      STREAM_APPROX,
      STREAM_MAXLEN,
      "*",
      "spaceId",
      spaceId,
      "type",
      "space.fs.changed",
      "payload",
      JSON.stringify({ type: "space.fs.changed", spaceId, payload, trace: {} }),
    );
  } catch (error) {
    console.warn(`[SpaceEvents] Failed to publish space fs changed for ${spaceId}:`, error);
    throw error;
  }
}
