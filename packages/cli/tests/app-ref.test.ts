import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAppRef } from "../src/app-ref.js";

const id = "123e4567-e89b-42d3-a456-426614174000";

test("parseAppRef accepts ids and management URLs", () => {
  assert.deepEqual(parseAppRef(id), { id });
  assert.deepEqual(parseAppRef(`https://cohub.run/spaces/${id}/works/${id}`), { id });
});

test("parseAppRef accepts public references", () => {
  const expected = { username: "alice", spaceSlug: "studio", appSlug: "launch" };
  assert.deepEqual(parseAppRef("alice/studio/launch"), expected);
  assert.deepEqual(parseAppRef("cohub://apps/alice/studio/launch"), expected);
  // Legacy spellings keep resolving.
  assert.deepEqual(parseAppRef("cohub://works/alice/studio/launch"), expected);
  assert.deepEqual(parseAppRef("app://alice/studio/launch"), expected);
  assert.deepEqual(parseAppRef("work://alice/studio/launch"), expected);
});

test("parseAppRef preserves launch state so it can be forwarded to the app", () => {
  assert.deepEqual(parseAppRef("https://cohub.run/alice/studio/w/launch?view=one"), {
    username: "alice",
    spaceSlug: "studio",
    appSlug: "launch",
    search: "?view=one",
  });
  assert.deepEqual(parseAppRef("cohub://works/alice/studio/launch?tab=a#today"), {
    username: "alice",
    spaceSlug: "studio",
    appSlug: "launch",
    search: "?tab=a",
    hash: "#today",
  });
});

test("parseAppRef rejects ambiguous or invalid references", () => {
  assert.throws(() => parseAppRef("launch"), /App must be/);
  assert.throws(() => parseAppRef("alice/studio/bad.slug"), /App must be/);
  assert.throws(() => parseAppRef("cohub://works/-alice/studio/launch"), /App must be/);
  assert.throws(() => parseAppRef("cohub://works/alice--dev/studio/launch"), /App must be/);
  assert.throws(() => parseAppRef("https://cohub.run/alice/studio/w/launch/extra"), /App must be/);
});
