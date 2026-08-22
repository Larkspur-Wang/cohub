import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The works REST surface is frozen wire contract: external consumers (e.g.
 * neta-studio) and the SDK call `/api/works*` paths and read response field
 * names like `work` / `works` / `workScopes` / `workId` directly, and the
 * server promises to keep serving exactly those.
 *
 * Route-level integration tests are impractical here (the route module wires
 * db/redis at import time), so this contract test instead extracts both sides
 * from source and matches them: every path the SDK (and web's direct calls)
 * requests must be mounted by the api router table. Renaming a mount prefix or
 * an internal path — without the matching SDK change — fails here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, "..", "..");
const REPO_ROOT = join(API_ROOT, "..", "..");

const read = (...segments: string[]) => readFileSync(join(...segments), "utf-8");

const SDK_SOURCES = [
  "packages/sdk/src/apis/apps.ts",
  "packages/sdk/src/apis/app-commerce.ts",
  "packages/sdk/src/apis/app-realtime.ts",
  "packages/sdk/src/app-bridge-core.ts",
  "packages/sdk/src/app-runtime.ts",
];

/** Web-side direct calls (SSR + broker page) that bypass the SDK. */
const WEB_DIRECT_PATHS = [
  "/api/works/by-slug/:p/:p/:p",
  "/api/works/:p/public",
];

/** Normalize a template string: `${...}` interpolations become `:p` segments. */
function normalizePath(raw: string): string {
  return raw
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .replace(/^\/api/, "/api");
}

/** Extract every `/api/...` request path a source file mentions. */
function extractApiPaths(source: string): string[] {
  const paths: string[] = [];
  for (const match of source.matchAll(/[`"'](\/api\/[^`"']*)[`"']/g)) {
    paths.push(normalizePath(match[1] ?? ""));
  }
  return paths;
}

/** One route segment matches when both are parameters or both are equal. */
function segmentsMatch(routeSegments: string[], pathSegments: string[]): boolean {
  return (
    routeSegments.length === pathSegments.length &&
    routeSegments.every(
      (segment, index) =>
        (segment.startsWith(":") && pathSegments[index]?.startsWith(":")) ||
        segment === pathSegments[index],
    )
  );
}

test("every works REST path the SDK requests is mounted by the api", () => {
  // Build the api route table from routes/index.ts: import bindings plus
  // router.route(prefix, routerName) mounts, then each route file's
  // router.<method>("path") registrations under that prefix.
  const indexSource = read(API_ROOT, "src", "routes", "index.ts");
  const imports = new Map<string, string>();
  for (const match of indexSource.matchAll(/import\s+(\w+)\s+from\s+"\.\/([^"]+)"/g)) {
    imports.set(match[1] ?? "", join(API_ROOT, "src", "routes", `${(match[2] ?? "").replace(/\.js$/, "")}.ts`));
  }

  const mounted: string[] = [];
  for (const match of indexSource.matchAll(/router\.route\("([^"]+)",\s*(\w+)\)/g)) {
    const prefix = match[1] ?? "";
    const file = imports.get(match[2] ?? "");
    if (!file) continue;
    const routeSource = readFileSync(file, "utf-8");
    for (const inner of routeSource.matchAll(
      /\.route\(\s*"(\/[^"]*)"\s*,\s*\w+\s*\)|\.(?:get|post|patch|put|delete)\(\s*"(\/[^"]*)"/g,
    )) {
      const path = inner[1] ?? inner[2] ?? "";
      if (!path || path === "/") {
        mounted.push(normalizePath(prefix));
      } else {
        mounted.push(normalizePath(`${prefix}${path}`));
      }
    }
  }

  const sdkPaths = new Set<string>();
  for (const source of SDK_SOURCES) {
    for (const path of extractApiPaths(read(REPO_ROOT, source))) {
      // Only the frozen works surface is under contract here.
      if (path.startsWith("/api/works")) sdkPaths.add(path);
    }
  }
  for (const path of WEB_DIRECT_PATHS) sdkPaths.add(path);
  assert.ok(sdkPaths.size >= 20, `expected the full works surface, found ${sdkPaths.size}`);

  const missing = [...sdkPaths].filter(
    (path) => !mounted.some((route) => segmentsMatch(route.split("/"), path.split("/"))),
  );
  assert.deepEqual(
    missing,
    [],
    "works REST paths are frozen: mount or route changes must keep serving these",
  );
});

test("the works list response keeps its frozen `works` wrapper key", () => {
  const source = read(API_ROOT, "src", "routes", "apps.route.ts");
  assert.match(
    source,
    /\{ works \} satisfies \{ works: RealtimeAppRecord\[\] \}/,
    "the list endpoint must keep returning { works: [...] }",
  );
});
