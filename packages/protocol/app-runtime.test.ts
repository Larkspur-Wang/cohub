import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAppRuntimeConfigureRequest,
  parseAppRuntimeConfigureRequest,
} from "./src/app-runtime.js";

test("configure.request round-trips geometry and input region", () => {
  const message = parseAppRuntimeConfigureRequest(
    buildAppRuntimeConfigureRequest({
      geometry: { anchor: "bottom-right", x: 12, y: 12, width: 260, height: 220 },
      inputRegion: [{ x: 0, y: 0, width: 260, height: 220 }],
    }),
  );
  assert.deepEqual(message?.geometry, { anchor: "bottom-right", x: 12, y: 12, width: 260, height: 220 });
  assert.deepEqual(message?.inputRegion, [{ x: 0, y: 0, width: 260, height: 220 }]);
});

test("configure.request drops invalid fields instead of failing", () => {
  const message = parseAppRuntimeConfigureRequest({
    protocol: "cohub.app.runtime",
    version: 1,
    type: "configure.request",
    geometry: { anchor: "middle", x: "10", y: Number.NaN, width: -1, height: 40 },
    inputRegion: [{ x: 0, y: 0, width: 0, height: 10 }, { x: 1, y: 2, width: 3, height: 4 }, "junk"],
  });
  assert.deepEqual(message?.geometry, { height: 40 });
  assert.deepEqual(message?.inputRegion, [{ x: 1, y: 2, width: 3, height: 4 }]);
});

test("configure.request accepts the keyword input regions and rejects other envelopes", () => {
  assert.equal(parseAppRuntimeConfigureRequest(buildAppRuntimeConfigureRequest({ inputRegion: "all" }))?.inputRegion, "all");
  assert.equal(parseAppRuntimeConfigureRequest(buildAppRuntimeConfigureRequest({ inputRegion: "none" }))?.inputRegion, "none");
  assert.equal(parseAppRuntimeConfigureRequest({ protocol: "cohub.app.runtime", version: 1, type: "ready" }), null);
  assert.equal(parseAppRuntimeConfigureRequest(null), null);
});
