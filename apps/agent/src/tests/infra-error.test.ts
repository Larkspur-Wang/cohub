import assert from "node:assert/strict";

const { classifySandboxInfrastructureError } = await import("@cohub/sandbox-client");

assert.equal(
  classifySandboxInfrastructureError("stat /workspace/node_modules/lucide-svelte/dist/icons: no such file or directory"),
  null,
  "ordinary missing-path errors should not trigger sandbox recovery",
);

assert.equal(
  classifySandboxInfrastructureError("open /workspace: input/output error")?.code,
  "CRITICAL_MOUNT_IO",
  "definitive I/O errors on critical mounts should still be classified",
);

assert.equal(
  classifySandboxInfrastructureError("stale file handle on /sessions")?.code,
  "STALE_MOUNT",
  "stale mount failures should remain recoverable infra errors",
);

console.log("infra-error classification checks passed");
