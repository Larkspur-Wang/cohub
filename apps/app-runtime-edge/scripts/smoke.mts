import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
assert.ok(args.includes("--environment"), "Pass --environment dev|prod.");
const environment = args[args.indexOf("--environment") + 1];
assert.ok(environment === "dev" || environment === "prod", "Pass --environment dev|prod.");
const appUrls = {
  dev: "https://works.cohub.live/dev/w/e7738991-0380-4b8d-804c-968adfad1f5f/desktop/7bd16ea47a7d/content/index.html",
  prod: "https://works.cohub.live/w/bcff6c3a-7259-4eb9-8674-160cf83aee26/desktop/3c762dcd08d6/content/index.html",
};
const appUrl = args.includes("--app-url") ? args[args.indexOf("--app-url") + 1] : appUrls[environment];
assert.ok(appUrl, "Missing App URL.");
const app = new URL(appUrl);
assert.equal(app.origin, "https://works.cohub.live");
assert.ok(app.pathname.startsWith(environment === "dev" ? "/dev/w/" : "/w/"));
const runtimePath = environment === "dev" ? "/__cohub_dev/runtime.js" : "/__cohub/runtime.js";
const runtimeUrl = new URL(runtimePath, app).href;
const expectedSource = await readFile(new URL(`../dist/runtime-${environment}.js`, import.meta.url), "utf8");
const expectedHash = createHash("sha256").update(expectedSource).digest("hex");

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "error",
    headers: { "User-Agent": "Cohub-Runtime-Smoke/1.0", "Cache-Control": "no-cache", ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
}

async function verify(): Promise<void> {
  const runtime = await request(runtimeUrl);
  assert.equal(runtime.status, 200, "Runtime must be available.");
  assert.equal(runtime.headers.get("cache-control"), "public, max-age=900, must-revalidate");
  assert.match(runtime.headers.get("content-type") ?? "", /^application\/javascript\b/);
  assert.equal(await runtime.text(), expectedSource, "The deployed runtime must match this build.");
  const etag = runtime.headers.get("etag");
  assert.ok(etag, "Runtime must expose a content validator.");
  // Cloudflare may weaken ETags when applying response compression.
  assert.equal(etag.replace(/^W\//, ""), `"${expectedHash}"`);
  const unchanged = await request(runtimeUrl, { headers: { "If-None-Match": etag } });
  assert.equal(unchanged.status, 304);
  const head = await request(runtimeUrl, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const page = await request(app.href, { headers: { Accept: "text/html", "Sec-Fetch-Dest": "iframe" } });
  assert.equal(page.status, 200, "The App fixture must be available.");
  const html = await page.text();
  const tag = `<script data-cohub-runtime="${environment}" data-cfasync="false" src="${runtimeUrl}" defer></script>`;
  assert.equal(html.split(tag).length - 1, 1, "Inject the runtime exactly once.");
  assert.equal(page.headers.get("cache-control"), "public, max-age=259200");
  const raw = await request(app.href, { headers: { Accept: "*/*", "Sec-Fetch-Dest": "empty" } });
  assert.equal(raw.status, 200);
  assert.ok(!(await raw.text()).includes(tag), "Raw downloads must not contain the injected runtime.");
}

// Retry only public reads while a deployment propagates; never republish on a failed probe.
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    await verify();
    console.log(JSON.stringify({ environment, appUrl, runtimeUrl, runtimeSha256: expectedHash, verified: true }));
    break;
  } catch (cause) {
    if (attempt === 5) throw cause;
    console.warn(`Verification attempt ${attempt} failed; retrying public reads.`);
    await delay(2_000);
  }
}
