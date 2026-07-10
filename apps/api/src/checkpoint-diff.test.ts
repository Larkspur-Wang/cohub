import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNameStatus, parseNumstat } from "./checkpoint-diff-parse.js";

describe("parseNameStatus", () => {
  it("parses added/modified/deleted entries", () => {
    const buf = Buffer.from("A\0foo.ts\0M\0bar.ts\0D\0baz.ts\0");
    assert.deepEqual(parseNameStatus(buf), [
      { status: "A", path: "foo.ts" },
      { status: "M", path: "bar.ts" },
      { status: "D", path: "baz.ts" },
    ]);
  });

  it("parses renames with old and new paths", () => {
    const buf = Buffer.from("R100\0old.ts\0new.ts\0M\0keep.ts\0");
    assert.deepEqual(parseNameStatus(buf), [
      { status: "R", path: "new.ts", oldPath: "old.ts" },
      { status: "M", path: "keep.ts" },
    ]);
  });
});

describe("parseNumstat", () => {
  it("parses line counts and binary markers", () => {
    const buf = Buffer.from("12\t3\tsrc/a.ts\0-\t-\tbin.png\0");
    const map = parseNumstat(buf);
    assert.deepEqual(map.get("src/a.ts"), { additions: 12, deletions: 3, binary: false });
    assert.deepEqual(map.get("bin.png"), { additions: null, deletions: null, binary: true });
  });

  it("parses rename entries where paths are separate NUL fields", () => {
    // git -z numstat rename: stats\0old\0new\0
    const rename = Buffer.concat([
      Buffer.from("0\t0\t"),
      Buffer.from([0]),
      Buffer.from("old.ts"),
      Buffer.from([0]),
      Buffer.from("new.ts"),
      Buffer.from([0]),
    ]);
    const map = parseNumstat(rename);
    assert.deepEqual(map.get("new.ts"), { additions: 0, deletions: 0, binary: false });
    assert.equal(map.has("old.ts"), false);
  });

  it("parses mixed normal and rename entries", () => {
    const buf = Buffer.concat([
      Buffer.from("4\t1\ta.ts"),
      Buffer.from([0]),
      Buffer.from("0\t0\t"),
      Buffer.from([0]),
      Buffer.from("old.ts"),
      Buffer.from([0]),
      Buffer.from("new.ts"),
      Buffer.from([0]),
      Buffer.from("-\t-\tpic.bin"),
      Buffer.from([0]),
    ]);
    const map = parseNumstat(buf);
    assert.deepEqual(map.get("a.ts"), { additions: 4, deletions: 1, binary: false });
    assert.deepEqual(map.get("new.ts"), { additions: 0, deletions: 0, binary: false });
    assert.deepEqual(map.get("pic.bin"), { additions: null, deletions: null, binary: true });
  });
});
