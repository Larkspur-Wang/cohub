import assert from "node:assert/strict";
import {
  collectLocalPageAssetRefs,
  extractHtmlPageMeta,
  fillIconFromSiteFiles,
  normalizeLocalPageAssetRef,
} from "./html-meta.js";

const html = `<!doctype html>
<html>
  <head>
    <title>  Launch Board </title>
    <meta name="description" content="Ship demos from Cohub Spaces." />
    <meta property="og:image" content="/cover.png" />
    <link rel="icon" href="./favicon.svg" sizes="any" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
  </head>
  <body></body>
</html>`;

const meta = extractHtmlPageMeta(html);
assert.equal(meta.title, "Launch Board");
assert.equal(meta.description, "Ship demos from Cohub Spaces.");
assert.equal(meta.image, "/cover.png");
assert.equal(meta.icon, "/apple-touch-icon.png");

const filled = fillIconFromSiteFiles(
  { title: null, description: null, icon: null, image: null },
  ["index.html", "assets/app.js", "favicon.ico"],
);
assert.equal(filled.icon, "favicon.ico");

const entities = extractHtmlPageMeta(
  `<html><head><title>A &amp; B</title><meta name="description" content="Hello&nbsp;world"></head></html>`,
);
assert.equal(entities.title, "A & B");
assert.equal(entities.description, "Hello world");

assert.equal(normalizeLocalPageAssetRef("./assets/icon.png"), "assets/icon.png");
assert.equal(normalizeLocalPageAssetRef("/favicon.svg"), "favicon.svg");
assert.equal(normalizeLocalPageAssetRef("https://cdn.example/a.png"), null);
assert.equal(normalizeLocalPageAssetRef("../secret.png"), null);

const packed = collectLocalPageAssetRefs({
  title: null,
  description: null,
  icon: "./favicon.svg",
  image: "https://cdn.example/cover.png",
});
assert.deepEqual(packed, ["favicon.svg"]);

const fallbacks = collectLocalPageAssetRefs({
  title: null,
  description: null,
  icon: null,
  image: null,
});
assert.ok(fallbacks.includes("favicon.ico"));
assert.ok(fallbacks.includes("favicon.svg"));

console.log("works/html-meta tests passed");
