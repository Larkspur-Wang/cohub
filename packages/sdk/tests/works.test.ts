import assert from "node:assert/strict";
import { test } from "node:test";
import { WorksApi } from "../src/apis/works.js";
import type { HttpTransport } from "../src/transport.js";

test("WorksApi.getBySlug forwards the abort signal", async () => {
  const controller = new AbortController();
  const transport = {
    request: async (path: string, init?: RequestInit) => {
      assert.equal(path, "/api/works/by-slug/alice/studio/launch");
      assert.equal(init?.signal, controller.signal);
      return {};
    },
  } as unknown as HttpTransport;

  await new WorksApi(transport).getBySlug("alice", "studio", "launch", {
    signal: controller.signal,
  });
});
