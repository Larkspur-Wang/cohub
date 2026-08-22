import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAppComposerChipClear,
  buildAppComposerChipSet,
  parseAppComposerChipClear,
  parseAppComposerChipSet,
  APP_COMPOSER_CHIP_CONTENT_MAX_BYTES,
} from "./src/app-surface.js";

test("App composer chip messages round-trip without changing content", () => {
  const chip = {
    key: "selection",
    label: "3 selected",
    content: "Selected records:\n- customer_123\n- customer_456",
  };

  assert.deepEqual(parseAppComposerChipSet(buildAppComposerChipSet(chip)), {
    protocol: "cohub.app.surface",
    version: 1,
    type: "composer.chip.set",
    chip,
  });
  assert.deepEqual(parseAppComposerChipClear(buildAppComposerChipClear(chip.key)), {
    protocol: "cohub.app.surface",
    version: 1,
    type: "composer.chip.clear",
    key: chip.key,
  });
});

test("App composer chips reject empty, oversized, and malformed input", () => {
  const message = (chip: Record<string, unknown>) => ({
    protocol: "cohub.app.surface",
    version: 1,
    type: "composer.chip.set",
    chip,
  });

  assert.equal(parseAppComposerChipSet(message({ key: "", label: "Item", content: "value" })), null);
  assert.equal(parseAppComposerChipSet(message({ key: "item", label: " ", content: "value" })), null);
  assert.equal(parseAppComposerChipSet(message({ key: "item", label: "Item", content: " " })), null);
  assert.equal(
    parseAppComposerChipSet(
      message({
        key: "item",
        label: "Item",
        content: "x".repeat(APP_COMPOSER_CHIP_CONTENT_MAX_BYTES + 1),
      }),
    ),
    null,
  );
});
