import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import previewRouter from "./preview.route.js";

function createTestApp() {
  const app = new Hono();
  app.route("/", previewRouter);
  app.get("/internal/ping", (c) => c.json({ ok: true }));
  app.notFound((c) => c.json({ message: "not found" }, 404));
  return app;
}

test("preview router does not intercept later routes", async () => {
  const app = createTestApp();
  const response = await app.request("/internal/ping", {
    headers: { host: "api-dev.cohub.run" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("preview routes remain preview-host only", async () => {
  const app = createTestApp();
  const response = await app.request("/__session", {
    headers: { host: "api-dev.cohub.run" },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: "not found" });
});
