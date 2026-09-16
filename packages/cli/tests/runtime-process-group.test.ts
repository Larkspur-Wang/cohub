import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JsonRpcProcess } from "../src/runtime/json-rpc.js";

test("RPC close waits for a SIGTERM-resistant descendant with detached pipes", { skip: process.platform !== "linux", timeout: 10_000 }, async () => {
  const rpc = new JsonRpcProcess(process.execPath, [fileURLToPath(new URL("./fixtures/runtime-process-tree.mjs", import.meta.url))], process.cwd(), "codex");
  let pids: number[] = [];
  try {
    const response = await rpc.request("pid"); pids = [Number(response.branch), Number(response.leaf)];
    assert(pids.every((pid) => Number.isInteger(pid) && pid > 0));
    const started = Date.now();
    await rpc.close();
    assert(Date.now() - started >= 1900, "leader exit must not cancel group escalation");
    for (const pid of pids) {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
      assert(stat === null || ["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] ?? ""), `descendant ${pid} cannot execute after close returns`);
    }
    await rpc.close();
  } finally {
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } }
    await rpc.close();
  }
});
