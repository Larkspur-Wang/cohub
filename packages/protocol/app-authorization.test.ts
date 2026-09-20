import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_SILENT_SHELL_SCOPES,
  isAppSilentShellScope,
} from "./src/app-authorization.js";

test("Shell auto-authorization keeps the approved read-only scope set explicit", () => {
  assert.deepEqual(APP_SILENT_SHELL_SCOPES, [
    "space.view",
    "file.view",
    "file.view.filtered",
    "session.view",
    "taskrun.view",
    "checkpoint.view",
  ]);
  assert.equal(isAppSilentShellScope("file.view"), true);
  assert.equal(isAppSilentShellScope("checkpoint.view"), true);
  assert.equal(isAppSilentShellScope("file.edit"), false);
  assert.equal(isAppSilentShellScope("session.prompt.readonly"), false);
});
