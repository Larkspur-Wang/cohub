import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreBoardConnectionRows } from "./board-connections.js";

test("restore keeps semantic item connection endpoints", () => {
  const rows = restoreBoardConnectionRows([
    {
      id: "edge",
      source: { itemId: "a", anchor: { kind: "auto" } },
      target: { itemId: "b", anchor: { kind: "auto" } },
      relation: "related",
      direction: "forward",
      label: "",
      routing: { kind: "straight", bend: 0, waypoints: [] },
      style: { color: "brand", size: 2, line: "solid" },
      metadata: {},
    },
  ], "board", new Set(["a", "b"]), new Date(0));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceNodeId, "a");
  assert.equal(rows[0]?.targetNodeId, "b");
});
