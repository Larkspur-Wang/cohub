import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardOperation } from "@cohub/protocol";
import { collectValidationNodeIds } from "./board-validation-projection.js";

test("validation projection includes only node ids referenced by the transaction", () => {
  const operations: BoardOperation[] = [
    { type: "node.patch", payload: { nodeId: "title", patch: { x: 20 } } },
    {
      type: "connection.create",
      payload: {
        connection: {
          id: "edge",
          source: { itemId: "title", anchor: { kind: "auto" } },
          target: { itemId: "hero", anchor: { kind: "auto" } },
          relation: "related",
          direction: "forward",
          label: "",
          routing: { kind: "curve", bend: 0, waypoints: [] },
          style: { color: "brand", size: 2, line: "solid" },
          metadata: {},
        },
      },
    },
    {
      type: "effect.upsert",
      payload: {
        effect: {
          id: "pulse",
          target: { type: "item", itemId: "hero" },
          kind: "effects.pulse",
          kindVersion: 1,
          enabled: true,
          lifecycle: "manual",
          timeOrigin: "board",
          layer: "front",
          seed: "seed",
          params: {},
          assetRefs: [],
          metadata: {},
        },
      },
    },
  ];
  assert.deepEqual(new Set(collectValidationNodeIds(operations)), new Set(["title", "hero"]));
});
