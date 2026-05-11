import assert from "node:assert/strict";
import type { SessionHandle } from "../session.js";

process.env.LOCAL_SANDBOX_SPACE_ID = "test-space";
process.env.LOCAL_SANDBOX_WS_URL = "ws://127.0.0.1:1/sandbox";

const { __test } = await import("../index.js");

function createOperationHandle(): SessionHandle {
  return {
    sessionId: "test-session",
    operationChain: Promise.resolve(),
  } as SessionHandle;
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const handle = createOperationHandle();
const events: string[] = [];

await withTimeout(
  __test.runInSessionOperation(handle, async () => {
    events.push("outer:start");
    events.push("shell:start");
    events.push("shell:end");
    events.push("outer:end");
  }),
  500,
  "non-nested shell-command operation",
);

assert.deepEqual(events, ["outer:start", "shell:start", "shell:end", "outer:end"]);

console.log("session operation shell-command checks passed");
