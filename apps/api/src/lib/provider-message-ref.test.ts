import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderMessageRefMeta } from "./provider-message-ref.js";

test("buildProviderMessageRefMeta preserves the provider event without transforming it", () => {
  const providerEvent = {
    event: { message: { thread_id: "thread-1", parent_id: "message-1" } },
  };

  const meta = buildProviderMessageRefMeta({ bindingKey: "binding-1" }, providerEvent);

  assert.equal(meta.providerEvent, providerEvent);
  assert.deepEqual(meta, {
    bindingKey: "binding-1",
    providerEvent,
  });
});

test("buildProviderMessageRefMeta omits absent provider events", () => {
  assert.deepEqual(buildProviderMessageRefMeta({ bindingKey: "binding-1" }, undefined), {
    bindingKey: "binding-1",
  });
});
