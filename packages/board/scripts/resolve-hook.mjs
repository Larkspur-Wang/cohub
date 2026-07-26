/**
 * Resolution hook for `node --test` over this package's sources.
 *
 * The sources use `.js` specifiers (which the build rewrites) and import
 * `@cohub/protocol` by name, whose `dist` is not built during a source-only test
 * run. Both are mapped to TypeScript sources here so the tests can import the
 * modules unchanged.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protocolSrc = resolvePath(here, "..", "..", "protocol", "src");

const PACKAGE_SOURCES = new Map([
  ["@cohub/protocol", `${protocolSrc}/index.ts`],
  ["@cohub/protocol/board-document", `${protocolSrc}/board-document.ts`],
  ["@cohub/protocol/board-constants", `${protocolSrc}/board-constants.ts`],
]);

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

export function resolve(specifier, context, next) {
  const mapped = PACKAGE_SOURCES.get(specifier);
  if (mapped && isFile(mapped)) {
    return { url: pathToFileURL(mapped).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const target = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    if (!isFile(target)) {
      const asTs = `${target.slice(0, -3)}.ts`;
      if (isFile(asTs)) return { url: pathToFileURL(asTs).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
