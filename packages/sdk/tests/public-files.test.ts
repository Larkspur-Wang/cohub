import assert from "node:assert/strict";
import { test } from "node:test";
import { CohubHttpClient } from "../src/http.js";
import type { Fetch } from "../src/transport.js";

function jsonResponse(body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("space public files use concise space-scoped routes", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: Fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return jsonResponse({ entries: [] });
  };
  const publicFiles = new CohubHttpClient({ baseUrl: "https://api.example.test", fetch })
    .space("space-1")
    .publicFiles;

  await publicFiles.createUpload({
    overwrite: true,
    entries: [{ id: "one", relativePath: "demo/index.html", size: 10, mimeType: "text/html" }],
  });
  await publicFiles.list("demo", { recursive: true, limit: 100, cursor: "next-page" });
  await publicFiles.url("demo/index.html");
  await publicFiles.delete("demo", true);

  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/api/spaces/space-1/public/uploads");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    overwrite: true,
    entries: [{ id: "one", relativePath: "demo/index.html", size: 10, mimeType: "text/html" }],
  });
  assert.equal(requests[0]?.init?.method, "POST");

  const listUrl = new URL(requests[1]?.url ?? "");
  assert.equal(listUrl.pathname, "/api/spaces/space-1/public");
  assert.equal(listUrl.searchParams.get("path"), "demo");
  assert.equal(listUrl.searchParams.get("recursive"), "true");
  assert.equal(listUrl.searchParams.get("limit"), "100");
  assert.equal(listUrl.searchParams.get("cursor"), "next-page");

  const publicUrl = new URL(requests[2]?.url ?? "");
  assert.equal(publicUrl.pathname, "/api/spaces/space-1/public/url");
  assert.equal(publicUrl.searchParams.get("path"), "demo/index.html");

  const deleteUrl = new URL(requests[3]?.url ?? "");
  assert.equal(deleteUrl.pathname, "/api/spaces/space-1/public");
  assert.equal(deleteUrl.searchParams.get("path"), "demo");
  assert.equal(deleteUrl.searchParams.get("recursive"), "true");
  assert.equal(requests[3]?.init?.method, "DELETE");
});
