import type { BoardOperation } from "@cohub/protocol";
import { collectTouchedNodeIds } from "./board-node-plan.js";

/** Node ids whose existence a transaction can observe or require. */
export function collectValidationNodeIds(operations: readonly BoardOperation[]): string[] {
  const ids = new Set(collectTouchedNodeIds(operations));
  for (const operation of operations) {
    if (operation.type === "connection.create") {
      ids.add(operation.payload.connection.source.itemId);
      ids.add(operation.payload.connection.target.itemId);
      continue;
    }
    if (operation.type === "connection.patch") {
      if (operation.payload.patch.source) ids.add(operation.payload.patch.source.itemId);
      if (operation.payload.patch.target) ids.add(operation.payload.patch.target.itemId);
      continue;
    }
    if (operation.type === "effect.upsert") {
      if (operation.payload.effect.target.type === "item") ids.add(operation.payload.effect.target.itemId);
      continue;
    }
    if (operation.type !== "composition.apply") continue;
    for (const track of operation.payload.composition.timeline.tracks) {
      if (track.target.type === "item") ids.add(track.target.itemId);
    }
    for (const clip of operation.payload.composition.timeline.clips) {
      if (clip.target.type === "item") ids.add(clip.target.itemId);
      if (clip.kind !== "camera.focus") continue;
      const focus = clip.params.focus;
      if (!focus || typeof focus !== "object" || Array.isArray(focus)) continue;
      const record = focus as Record<string, unknown>;
      if (typeof record.itemId === "string") ids.add(record.itemId);
      if (typeof record.frameId === "string") ids.add(record.frameId);
      if (Array.isArray(record.itemIds)) {
        for (const id of record.itemIds) if (typeof id === "string") ids.add(id);
      }
    }
  }
  return [...ids];
}
