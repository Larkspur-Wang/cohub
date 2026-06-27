import { randomUUID } from "node:crypto";
import { buildResourceLabelSnapshot, type LabelResourceType } from "@cohub/core/labels/resource-events";
import { db } from "./db.js";
import { redisCommandClient } from "./redis.js";

const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";

export async function dispatchLabelAssignmentsUpdated(input: {
  spaceId: string;
  resourceType: LabelResourceType;
  resourceRef: string;
  sessionId?: string | null;
  affectedLabelIds?: string[];
}) {
  const snapshot = await buildResourceLabelSnapshot({ db, ...input });
  await redisCommandClient.publish(
    REALTIME_OUTBOUND_CHANNEL,
    JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "label",
      type: "label.assignments.updated",
      spaceId: input.spaceId,
      sessionId: input.sessionId ?? (input.resourceType === "session" ? input.resourceRef : null),
      payload: {
        resourceType: input.resourceType,
        resourceRef: input.resourceRef,
        labels: snapshot.labels,
        assignments: snapshot.assignments,
        items: snapshot.items,
        affectedLabelIds: snapshot.affectedLabelIds,
      },
    }),
  );
}
