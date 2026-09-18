import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { Headers, Miniflare, Response, convertV4MiniflareOptions, type Request } from "miniflare";

const HOST = "https://works.cohub.live";
const ORIGIN_ETAG = '"artifact-v1"';
const LAST_MODIFIED = "Tue, 08 Sep 2026 11:08:03 GMT";
const NAVIGATION = { Accept: "text/html", "Sec-Fetch-Dest": "iframe" };
const BASE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title><script type="module" src="./app.js"></script></head><body><a href="/">App</a></body></html>';
const CACHE_CONTROL = "public, max-age=259200";
const ORIGIN_CONDITIONALS: Record<string, string>[] = [
  { "If-None-Match": ORIGIN_ETAG },
  { "If-Modified-Since": LAST_MODIFIED },
];
const workerSource = await readFile(new URL("../dist/worker.js", import.meta.url), "utf8");

type Environment = "dev" | "prod";
type OriginRequest = { method: string; url: string; headers: Headers };

function settings(environment: Environment) {
  return environment === "dev"
    ? { appPrefix: "/dev/w/", runtimePrefix: "/__cohub_dev/", otherAppPrefix: "/w/", otherRuntimePrefix: "/__cohub/" }
    : { appPrefix: "/w/", runtimePrefix: "/__cohub/", otherAppPrefix: "/dev/w/", otherRuntimePrefix: "/__cohub_dev/" };
}

function countRuntimeScripts(html: string, runtimeUrl: string) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .filter((match) => match[1] === runtimeUrl).length;
}

for (const environment of ["dev", "prod"] as const) {
  describe(`${environment} edge runtime`, { concurrency: false }, () => {
    const config = settings(environment);
    const runtimeUrl = `${HOST}${config.runtimePrefix}runtime.js`;
    const pageUrl = `${HOST}${config.appPrefix}fixture/content/index.html`;
    const originRequests: OriginRequest[] = [];
    let worker: Miniflare;

    function fixture(request: Request) {
      assert.equal(new URL(request.url).origin, HOST, "Unexpected outbound origin");
      originRequests.push({ method: request.method, url: request.url, headers: new Headers(request.headers) });
      const url = new URL(request.url);
      const variant = url.searchParams.get("fixture");
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
        ETag: ORIGIN_ETAG,
        "Last-Modified": LAST_MODIFIED,
        "Accept-Ranges": "bytes",
        "Content-MD5": "source-checksum",
        "x-oss-meta-sha256": "source-sha256",
        Vary: "Origin",
      });
      let body = BASE_HTML;
      if (variant === "no-head") body = "<body>App</body>";
      if (variant === "plain-head") body = "<html><head><title>App</title></head><body>App</body></html>";
      if (variant === "fragment") body = "App fragment";
      if (variant === "existing-after-module") {
        body = BASE_HTML.replace("</head>", `<script data-cohub-runtime="${environment}" src="${runtimeUrl}" defer></script></head>`);
      }
      if (variant === "existing-in-body") {
        body = BASE_HTML.replace("</body>", `<script data-cohub-runtime="${environment}" src="${runtimeUrl}" defer></script></body>`);
      }
      if (variant === "unrelated-marker") {
        body = BASE_HTML.replace("<title>", `<script data-cohub-runtime="${environment}" src="https://example.com/author.js"></script><title>`);
      }
      if (variant === "attachment") headers.set("Content-Disposition", 'attachment; filename="app.html"');
      if (variant === "no-transform") headers.set("Cache-Control", `${CACHE_CONTROL}, no-transform`);
      if (variant === "vary-star") headers.set("Vary", "*");
      if (variant === "csp") {
        const policy = "default-src 'none'; script-src 'nonce-author'; style-src 'self'";
        headers.set("Content-Security-Policy", policy);
        body = BASE_HTML.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="${policy}"><title>`);
      }
      if (url.pathname.endsWith("/asset.js")) {
        headers.set("Content-Type", "application/javascript");
        body = "export const original = true;";
      }
      if (url.pathname.endsWith("/missing.html")) return new Response("Missing", { status: 404, headers });
      if (url.pathname.endsWith("/redirect.html")) {
        headers.set("Location", "./index.html");
        return new Response(null, { status: 302, headers });
      }
      if (request.headers.has("Range")) {
        headers.set("Content-Range", `bytes 0-9/${body.length}`);
        return new Response(body.slice(0, 10), { status: 206, headers });
      }
      if (request.headers.get("If-None-Match") === ORIGIN_ETAG
        || (!request.headers.has("If-None-Match") && request.headers.get("If-Modified-Since") === LAST_MODIFIED)) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(request.method === "HEAD" ? null : body, { headers });
    }

    before(() => {
      worker = new Miniflare(convertV4MiniflareOptions({
        modules: true,
        script: workerSource,
        compatibilityDate: "2026-09-18",
        bindings: { COHUB_ENV: environment },
        outboundService: fixture,
      }));
    });

    after(async () => { await worker?.dispose(); });

    it("serves the built runtime with a 15-minute cache and content validator", async () => {
      const response = await worker.dispatchFetch(runtimeUrl);
      const body = await response.text();
      const built = await readFile(new URL(`../dist/runtime-${environment}.js`, import.meta.url), "utf8");
      assert.equal(response.status, 200);
      assert.equal(body, built);
      assert.match(response.headers.get("Content-Type") ?? "", /(?:application|text)\/javascript/);
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=900, must-revalidate");
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
      const etag = response.headers.get("ETag");
      assert.ok(etag);

      const head = await worker.dispatchFetch(runtimeUrl, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      assert.equal(head.headers.get("ETag"), response.headers.get("ETag"));
      const unchanged = await worker.dispatchFetch(runtimeUrl, { headers: { "If-None-Match": etag } });
      assert.equal(unchanged.status, 304);
      assert.equal(await unchanged.text(), "");
      assert.equal(unchanged.headers.get("ETag"), response.headers.get("ETag"));
      const wildcard = await worker.dispatchFetch(runtimeUrl, { headers: { "If-None-Match": "*" } });
      assert.equal(wildcard.status, 304);
    });

    it("rejects unsupported runtime methods and missing reserved assets", async () => {
      const post = await worker.dispatchFetch(runtimeUrl, { method: "POST" });
      assert.equal(post.status, 405);
      assert.equal(post.headers.get("Allow"), "GET, HEAD");
      assert.equal((await worker.dispatchFetch(`${HOST}${config.runtimePrefix}missing.js`)).status, 404);
    });

    it("only transforms this environment's App prefix", async () => {
      for (const url of [
        `${HOST}${config.otherAppPrefix}fixture/content/index.html`,
        `${HOST}${config.otherRuntimePrefix}runtime.js`,
        `${HOST}/unrelated/index.html`,
      ]) {
        const response = await worker.dispatchFetch(url, { headers: NAVIGATION });
        assert.equal(await response.text(), BASE_HTML, url);
      }
      assert.equal((await worker.dispatchFetch(`https://other.example${config.appPrefix}fixture.html`, { headers: NAVIGATION })).status, 404);
    });

    it("injects once before the App module without moving charset or changing the App body", async () => {
      const response = await worker.dispatchFetch(pageUrl, { headers: NAVIGATION });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.equal(countRuntimeScripts(html, runtimeUrl), 1);
      assert.ok(html.indexOf('charset="utf-8"') < html.indexOf(runtimeUrl));
      assert.ok(html.indexOf(runtimeUrl) < html.indexOf('type="module"'));
      assert.match(html, /<script[^>]*\bdefer(?:\s|>)/);
      assert.ok(html.includes('<body><a href="/">App</a></body>'));
      assert.equal(response.headers.get("Cache-Control"), CACHE_CONTROL);
      for (const name of ["origin", "accept", "sec-fetch-dest"]) {
        assert.ok(response.headers.get("Vary")?.toLowerCase().split(/,\s*/).includes(name));
      }
      for (const name of ["Content-Length", "Content-MD5", "Last-Modified", "Accept-Ranges", "x-oss-meta-sha256"]) {
        assert.equal(response.headers.get(name), null, name);
      }
      assert.notEqual(response.headers.get("ETag"), ORIGIN_ETAG);
      assert.ok(response.headers.get("X-Cohub-Runtime"));
    });

    it("supports document, frame and explicit HTML navigation, including query strings", async () => {
      const variants: Record<string, string>[] = [
        { Accept: "text/html", "Sec-Fetch-Dest": "document" },
        { Accept: "text/html", "Sec-Fetch-Dest": "frame" },
        { Accept: "text/html" },
      ];
      for (const headers of variants) {
        const response = await worker.dispatchFetch(`${pageUrl}?launch=preserved`, { headers });
        assert.equal(countRuntimeScripts(await response.text(), runtimeUrl), 1);
        const originRequest = originRequests.at(-1);
        assert.ok(originRequest);
        assert.equal(new URL(originRequest.url).search, "?launch=preserved");
      }
    });

    it("uses transformed validators instead of allowing an origin 304 to hide injection", async () => {
      const response = await worker.dispatchFetch(pageUrl, { headers: NAVIGATION });
      await response.text();
      const etag = response.headers.get("ETag");
      assert.ok(etag);
      for (const conditional of ORIGIN_CONDITIONALS) {
        const refreshed = await worker.dispatchFetch(pageUrl, { headers: { ...NAVIGATION, ...conditional } });
        assert.equal(refreshed.status, 200);
        assert.equal(countRuntimeScripts(await refreshed.text(), runtimeUrl), 1);
      }
      const unchanged = await worker.dispatchFetch(pageUrl, { headers: { ...NAVIGATION, "If-None-Match": `"unrelated", ${etag}` } });
      assert.equal(unchanged.status, 304);
      assert.equal(await unchanged.text(), "");
      assert.equal(unchanged.headers.get("ETag"), etag);
      const head = await worker.dispatchFetch(pageUrl, { method: "HEAD", headers: NAVIGATION });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      assert.equal(head.headers.get("ETag"), etag);
    });

    it("preserves raw fetches, downloads, ranges, non-HTML assets and error responses", async () => {
      const variants: Record<string, string>[] = [{ Accept: "*/*" }, { Accept: "text/html", "Sec-Fetch-Dest": "empty" }];
      for (const headers of variants) {
        const raw = await worker.dispatchFetch(pageUrl, { headers });
        assert.equal(await raw.text(), BASE_HTML);
        assert.equal(raw.headers.get("ETag"), ORIGIN_ETAG);
        assert.equal(raw.headers.get("Content-MD5"), "source-checksum");
      }
      const attachment = await worker.dispatchFetch(`${pageUrl}?fixture=attachment`, { headers: NAVIGATION });
      assert.equal(await attachment.text(), BASE_HTML);
      assert.equal(attachment.headers.get("Content-Disposition"), 'attachment; filename="app.html"');
      const range = await worker.dispatchFetch(pageUrl, { headers: { ...NAVIGATION, Range: "bytes=0-9" } });
      assert.equal(range.status, 206);
      assert.equal(await range.text(), BASE_HTML.slice(0, 10));
      assert.equal(range.headers.get("Content-Range"), `bytes 0-9/${BASE_HTML.length}`);
      const js = await worker.dispatchFetch(new URL("asset.js", pageUrl), { headers: NAVIGATION });
      assert.equal(await js.text(), "export const original = true;");
      const missing = await worker.dispatchFetch(new URL("missing.html", pageUrl), { headers: NAVIGATION });
      assert.equal(missing.status, 404);
      assert.equal(await missing.text(), "Missing");
      const redirect = await worker.dispatchFetch(new URL("redirect.html", pageUrl), { headers: NAVIGATION, redirect: "manual" });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("Location"), "./index.html");
    });

    it("honors no-transform in either request or response", async () => {
      for (const [url, headers] of [
        [pageUrl, { ...NAVIGATION, "Cache-Control": "no-cache, no-transform" }],
        [`${pageUrl}?fixture=no-transform`, NAVIGATION],
      ] as const) {
        const response = await worker.dispatchFetch(url, { headers });
        assert.equal(await response.text(), BASE_HTML);
        assert.equal(response.headers.get("ETag"), ORIGIN_ETAG);
        assert.equal(response.headers.get("X-Cohub-Runtime"), null);
      }
    });

    it("preserves conditional responses when the final representation is not transformed", async () => {
      for (const variant of ["attachment", "no-transform"]) {
        for (const conditional of ORIGIN_CONDITIONALS) {
          const response = await worker.dispatchFetch(`${pageUrl}?fixture=${variant}`, { headers: { ...NAVIGATION, ...conditional } });
          assert.equal(response.status, 304, `${variant}: ${JSON.stringify(conditional)}`);
          assert.equal(await response.text(), "");
          assert.equal(response.headers.get("ETag"), ORIGIN_ETAG);
        }
      }
      const raw = await worker.dispatchFetch(pageUrl, { headers: { Accept: "*/*", "If-None-Match": ORIGIN_ETAG } });
      assert.equal(raw.status, 304);
    });

    it("preserves CSP and existing policy placement", async () => {
      const response = await worker.dispatchFetch(`${pageUrl}?fixture=csp`, { headers: NAVIGATION });
      const html = await response.text();
      const policy = "default-src 'none'; script-src 'nonce-author'; style-src 'self'";
      assert.equal(response.headers.get("Content-Security-Policy"), policy);
      assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${policy}">`));
      assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf(runtimeUrl));
      const wildcard = await worker.dispatchFetch(`${pageUrl}?fixture=vary-star`, { headers: NAVIGATION });
      assert.equal(wildcard.headers.get("Vary"), "*");
      await wildcard.text();
    });

    it("injects into documents without a module, head or body", async () => {
      for (const variant of ["plain-head", "no-head", "fragment"]) {
        const response = await worker.dispatchFetch(`${pageUrl}?fixture=${variant}`, { headers: NAVIGATION });
        assert.equal(countRuntimeScripts(await response.text(), runtimeUrl), 1, variant);
      }
    });

    it("keeps exactly one owned runtime tag and preserves unrelated author scripts", async () => {
      for (const variant of ["existing-after-module", "existing-in-body"]) {
        const response = await worker.dispatchFetch(`${pageUrl}?fixture=${variant}`, { headers: NAVIGATION });
        assert.equal(countRuntimeScripts(await response.text(), runtimeUrl), 1, variant);
      }
      const response = await worker.dispatchFetch(`${pageUrl}?fixture=unrelated-marker`, { headers: NAVIGATION });
      const html = await response.text();
      assert.equal(countRuntimeScripts(html, runtimeUrl), 1);
      assert.ok(html.includes('src="https://example.com/author.js"'));
    });
  });
}
