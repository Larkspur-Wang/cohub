import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { WorkArtifactManifest, WorkGetResponse } from "@neta-art/cohub";
import { downloadWork } from "../src/work-download.js";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function manifestBytes(manifest: WorkArtifactManifest) {
  return Buffer.from(`${JSON.stringify(manifest)}\n`);
}

function memoryFetch(responses: Map<string, Buffer>): typeof fetch {
  return async (input) => {
    const body = responses.get(String(input));
    return body
      ? new Response(body, { status: 200, headers: { "content-length": String(body.byteLength) } })
      : new Response(null, { status: 404 });
  };
}

function directoryDetail(manifestSha256: string): WorkGetResponse {
  return {
    work: { id: "work-1", slug: "launch", latestVersion: 2 },
    content: {
      kind: "web",
      targetType: "directory",
      path: "dist",
      url: "https://cdn.test/content/index.html",
      download: {
        manifestUrl: "https://cdn.test/meta/manifest.json",
        manifestSha256,
      },
    },
  } as WorkGetResponse;
}

function fileDetail(manifestSha256: string): WorkGetResponse {
  return {
    work: { id: "work-2", slug: "report", latestVersion: 3 },
    content: {
      kind: "file",
      targetType: "file",
      path: "reports/result.txt",
      url: "https://cdn.test/content/content.txt",
      name: "result.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
      sha256: sha256("result\n"),
      download: {
        manifestUrl: "https://cdn.test/meta/manifest.json",
        manifestSha256,
      },
    },
  } as WorkGetResponse;
}

function singleFileManifest(content: Buffer): WorkArtifactManifest {
  return {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "file",
    targetRef: "reports/result.txt",
    entrypoint: "content.txt",
    fileCount: 1,
    sizeBytes: content.byteLength,
    files: [
      { artifactPath: "content.txt", outputPath: "result.txt", mimeType: "text/plain", sizeBytes: content.byteLength, sha256: sha256(content) },
    ],
  };
}

function htmlDetail(manifestSha256: string): WorkGetResponse {
  return {
    work: { id: "work-3", slug: "site", latestVersion: 4 },
    content: {
      kind: "web",
      targetType: "file",
      path: "site/page.html",
      url: "https://cdn.test/content/index.html",
      download: {
        manifestUrl: "https://cdn.test/meta/manifest.json",
        manifestSha256,
      },
    },
  } as WorkGetResponse;
}

test("downloadWork restores directory artifacts without content verification", async () => {
  const index = Buffer.from("<h1>Launch</h1>\n");
  const script = Buffer.from("console.log('ready');\n");
  const manifest: WorkArtifactManifest = {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "directory",
    targetRef: "dist",
    entrypoint: "index.html",
    fileCount: 2,
    sizeBytes: index.byteLength + script.byteLength,
    files: [
      { artifactPath: "index.html", outputPath: "index.html", mimeType: "text/html", sizeBytes: index.byteLength, sha256: sha256(index) },
      { artifactPath: "assets/app.js", outputPath: "assets/app.js", mimeType: "text/javascript", sizeBytes: script.byteLength, sha256: sha256(script) },
    ],
  };
  const encodedManifest = manifestBytes(manifest);
  const fetcher = memoryFetch(new Map([
    ["https://cdn.test/meta/manifest.json", encodedManifest],
    ["https://cdn.test/content/index.html", index],
    ["https://cdn.test/content/assets/app.js", script],
  ]));
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  const output = join(root, "launch");
  try {
    const result = await downloadWork(directoryDetail(sha256(encodedManifest)), output, fetcher);
    assert.equal(result.verified, false);
    assert.equal(result.unverifiedFiles, 2);
    assert.equal(result.files, 2);
    assert.equal(await readFile(join(output, "index.html"), "utf8"), index.toString());
    assert.equal(await readFile(join(output, "assets/app.js"), "utf8"), script.toString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork restores a single file", async () => {
  const content = Buffer.from("result\n");
  const manifest = singleFileManifest(content);
  const encodedManifest = manifestBytes(manifest);
  const fetcher = memoryFetch(new Map([
    ["https://cdn.test/meta/manifest.json", encodedManifest],
    ["https://cdn.test/content/content.txt", content],
  ]));
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  const output = join(root, "result.txt");
  try {
    const result = await downloadWork(fileDetail(sha256(encodedManifest)), output, fetcher);
    assert.equal(result.kind, "file");
    assert.equal(result.verified, false);
    assert.equal(result.unverifiedFiles, 1);
    assert.equal(await readFile(output, "utf8"), "result\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork does not replace a file created during download", async () => {
  const content = Buffer.from("result\n");
  const manifest = singleFileManifest(content);
  const encodedManifest = manifestBytes(manifest);
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  const output = join(root, "result.txt");
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://cdn.test/meta/manifest.json") return new Response(encodedManifest);
    if (url === "https://cdn.test/content/content.txt") {
      await writeFile(output, "keep\n", { flag: "wx" });
      return new Response(content);
    }
    return new Response(null, { status: 404 });
  };
  try {
    await assert.rejects(
      downloadWork(fileDetail(sha256(encodedManifest)), output, fetcher),
      /Output already exists/,
    );
    assert.equal(await readFile(output, "utf8"), "keep\n");
    assert.deepEqual(await readdir(root), ["result.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork does not replace a directory created during download", async () => {
  const content = Buffer.from("<h1>Launch</h1>\n");
  const manifest: WorkArtifactManifest = {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "directory",
    targetRef: "dist",
    entrypoint: "index.html",
    fileCount: 1,
    sizeBytes: content.byteLength,
    files: [
      { artifactPath: "index.html", outputPath: "index.html", mimeType: "text/html", sizeBytes: content.byteLength, sha256: sha256(content) },
    ],
  };
  const encodedManifest = manifestBytes(manifest);
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  const output = join(root, "launch");
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://cdn.test/meta/manifest.json") return new Response(encodedManifest);
    if (url === "https://cdn.test/content/index.html") {
      await mkdir(output);
      await writeFile(join(output, "existing.txt"), "keep\n");
      return new Response(content);
    }
    return new Response(null, { status: 404 });
  };
  try {
    await assert.rejects(
      downloadWork(directoryDetail(sha256(encodedManifest)), output, fetcher),
      /Output already exists/,
    );
    assert.equal(await readFile(join(output, "existing.txt"), "utf8"), "keep\n");
    assert.deepEqual(await readdir(root), ["launch"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork restores HTML companion assets as a directory bundle", async () => {
  const html = Buffer.from("<img src=\"assets/logo.svg\">\n");
  const logo = Buffer.from("<svg></svg>\n");
  const manifest: WorkArtifactManifest = {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "file",
    targetRef: "site/page.html",
    entrypoint: "index.html",
    fileCount: 2,
    sizeBytes: html.byteLength + logo.byteLength,
    files: [
      { artifactPath: "index.html", outputPath: "page.html", mimeType: "text/html", sizeBytes: html.byteLength, sha256: sha256(html) },
      { artifactPath: "assets/logo.svg", outputPath: "assets/logo.svg", mimeType: "image/svg+xml", sizeBytes: logo.byteLength, sha256: sha256(logo) },
    ],
  };
  const encodedManifest = manifestBytes(manifest);
  const fetcher = memoryFetch(new Map([
    ["https://cdn.test/meta/manifest.json", encodedManifest],
    ["https://cdn.test/content/index.html", html],
    ["https://cdn.test/content/assets/logo.svg", logo],
  ]));
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  const output = join(root, "site");
  try {
    const result = await downloadWork(htmlDetail(sha256(encodedManifest)), output, fetcher);
    assert.equal(result.kind, "directory");
    assert.equal(result.files, 2);
    assert.equal(await readFile(join(output, "page.html"), "utf8"), html.toString());
    assert.equal(await readFile(join(output, "assets/logo.svg"), "utf8"), logo.toString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork rejects traversal paths before writing", async () => {
  const content = Buffer.from("secret");
  const manifest: WorkArtifactManifest = {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "directory",
    targetRef: "dist",
    entrypoint: "assets/../secret.txt",
    fileCount: 1,
    sizeBytes: content.byteLength,
    files: [
      { artifactPath: "assets/../secret.txt", outputPath: "secret.txt", mimeType: "text/plain", sizeBytes: content.byteLength, sha256: sha256(content) },
    ],
  };
  const encodedManifest = manifestBytes(manifest);
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  try {
    await assert.rejects(
      downloadWork(directoryDetail(sha256(encodedManifest)), join(root, "launch"), memoryFetch(new Map([
        ["https://cdn.test/meta/manifest.json", encodedManifest],
      ]))),
      /Invalid artifact path/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork accepts CDN-rewritten content of any type", async () => {
  const published = Buffer.from("<link href=\"https://fonts.googleapis.com\"><h1>Launch</h1>\n");
  const rewritten = Buffer.from("<h1>Launch</h1>\n");
  const manifest: WorkArtifactManifest = {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "directory",
    targetRef: "dist",
    entrypoint: "index.html",
    fileCount: 1,
    sizeBytes: published.byteLength,
    files: [
      { artifactPath: "index.html", outputPath: "index.html", mimeType: "text/html", sizeBytes: published.byteLength, sha256: sha256(published) },
    ],
  };
  const encodedManifest = manifestBytes(manifest);
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  const output = join(root, "launch");
  try {
    const result = await downloadWork(directoryDetail(sha256(encodedManifest)), output, memoryFetch(new Map([
      ["https://cdn.test/meta/manifest.json", encodedManifest],
      ["https://cdn.test/content/index.html", rewritten],
    ])));
    assert.equal(result.verified, false);
    assert.equal(result.unverifiedFiles, 1);
    assert.equal(result.bytes, rewritten.byteLength);
    assert.equal(await readFile(join(output, "index.html"), "utf8"), rewritten.toString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork removes staged files after content download failure", async () => {
  const expected = Buffer.from("console.log('expected');\n");
  const manifest: WorkArtifactManifest = {
    kind: "cohub.work.artifact-manifest",
    version: 1,
    targetType: "directory",
    targetRef: "dist",
    entrypoint: "script.js",
    fileCount: 1,
    sizeBytes: expected.byteLength,
    files: [
      { artifactPath: "script.js", outputPath: "script.js", mimeType: "text/javascript", sizeBytes: expected.byteLength, sha256: sha256(expected) },
    ],
  };
  const encodedManifest = manifestBytes(manifest);
  const root = await mkdtemp(join(tmpdir(), "cohub-work-download-"));
  try {
    await assert.rejects(
      downloadWork(directoryDetail(sha256(encodedManifest)), join(root, "launch"), async (input) => {
        if (String(input) === "https://cdn.test/meta/manifest.json") return new Response(encodedManifest);
        return new Response(null, { status: 502 });
      }),
      /Failed to download/,
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("downloadWork clearly rejects unsupported Work types", async () => {
  const work = { id: "work-3", slug: "preview", latestVersion: 1 };
  const fetcher: typeof fetch = async () => {
    throw new Error("fetch should not run");
  };
  await assert.rejects(
    downloadWork({ work, content: { kind: "port", port: 5173, url: "https://preview.test" } } as WorkGetResponse, undefined, fetcher),
    /Port Works/,
  );
  await assert.rejects(
    downloadWork({ work, content: { kind: "board", url: "https://cdn.test/board.json" } } as WorkGetResponse, undefined, fetcher),
    /Board Works/,
  );
  await assert.rejects(
    downloadWork({ work, content: null } as WorkGetResponse, undefined, fetcher),
    /no published downloadable artifact/,
  );
});
