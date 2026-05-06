import { randomUUID } from "node:crypto";
import { db } from "./db/index.js";
import { spaceSandboxes } from "./db/schema-v2.js";
import { eq } from "drizzle-orm";
import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import type { SpacePortsChangedPayload } from "@neta-art/cohub-protocol/ports";
import { mergePortStatusesIntoMeta } from "./sandbox-public-network.js";
import { dispatchRealtimeEventToUsers, getReadableUserIdsForSpace } from "./channels.js";

export type SpaceFsChangedStreamEvent = {
  type: "space.fs.changed";
  spaceId: string;
  payload: SpaceFsChangedPayload;
  trace?: Record<string, unknown>;
};

export type SpacePortsChangedStreamEvent = {
  type: "space.ports.changed";
  spaceId: string;
  payload: SpacePortsChangedPayload;
  trace?: Record<string, unknown>;
};

export type SpaceEventStreamEvent = SpaceFsChangedStreamEvent | SpacePortsChangedStreamEvent;

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

export async function dispatchSpacePortsChanged(spaceId: string, payload: SpacePortsChangedPayload) {
  let readableUserIds: string[];
  try {
    readableUserIds = await getReadableUserIdsForSpace(spaceId);
  } catch (error) {
    console.warn(`[SpaceEvents] Failed to resolve readable users for ${spaceId}:`, error);
    throw error;
  }

  const [sandbox] = await db
    .select({ meta: spaceSandboxes.meta })
    .from(spaceSandboxes)
    .where(eq(spaceSandboxes.spaceId, spaceId))
    .limit(1);
  if (sandbox) {
    await db
      .update(spaceSandboxes)
      .set({ meta: mergePortStatusesIntoMeta(sandbox.meta as Record<string, unknown> | null, payload) })
      .where(eq(spaceSandboxes.spaceId, spaceId));
  }

  await dispatchRealtimeEventToUsers({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "space",
    type: "space.ports.changed",
    spaceId,
    sessionId: null,
    payload: {
      ...payload,
      targetUserIds: readableUserIds,
    },
  });
}
