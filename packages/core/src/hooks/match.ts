import { picomatch } from "./picomatch-shim.js";
import type { SpaceHookDefinition, SpaceHookEventEnvelope } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

const matcherCache = new Map<string, (path: string) => boolean>();

function getMatcher(pattern: string): (path: string) => boolean {
  const normalized = normalizePath(pattern);
  let matcher = matcherCache.get(normalized);
  if (!matcher) {
    matcher = picomatch(normalized, { dot: true });
    matcherCache.set(normalized, matcher);
  }
  return matcher;
}

function matchGlob(pattern: string, value: string): boolean {
  return getMatcher(pattern)(normalizePath(value));
}

function matchesAny(patterns: string[] | undefined, values: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  return values.some((value) => patterns.some((pattern) => matchGlob(pattern, value)));
}

function isIgnored(patterns: string[] | undefined, values: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  return values.every((value) => patterns.some((pattern) => matchGlob(pattern, value)));
}

function collectFsPaths(payload: Record<string, unknown>) {
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const paths: string[] = [];
  const kinds: string[] = [];
  for (const change of changes) {
    if (!isRecord(change)) continue;
    if (typeof change.path === "string" && change.path.trim()) paths.push(normalizePath(change.path));
    if (typeof change.oldPath === "string" && change.oldPath.trim()) paths.push(normalizePath(change.oldPath));
    if (typeof change.kind === "string" && change.kind.trim()) kinds.push(change.kind.trim());
  }
  return {
    paths: Array.from(new Set(paths)),
    kinds: Array.from(new Set(kinds)),
    resync: payload.resync === true,
  };
}

export function spaceHookMatchesEvent(
  hook: SpaceHookDefinition,
  event: SpaceHookEventEnvelope,
): { matched: boolean; reason?: string } {
  if (hook.event !== event.type) {
    return { matched: false, reason: "event_mismatch" };
  }

  if (event.type !== "space.fs.changed") {
    return { matched: true };
  }

  const { paths, kinds, resync } = collectFsPaths(event.payload);
  if (resync && paths.length === 0) {
    // Resync with no concrete paths is a "refresh your tree" signal, not a change.
    return { matched: false, reason: "fs_resync_no_paths" };
  }
  if (paths.length === 0) {
    return { matched: false, reason: "no_paths" };
  }

  // Always ignore .cohub/** to prevent hook self-trigger loops.
  const activePaths = paths.filter((path) =>
    !path.startsWith(".cohub/") && !isIgnored(hook.ignore, [path]));
  if (activePaths.length === 0) {
    return { matched: false, reason: "ignored" };
  }
  if (!matchesAny(hook.paths, activePaths)) {
    return { matched: false, reason: "path_filter" };
  }
  if (hook.kinds && hook.kinds.length > 0) {
    if (kinds.length === 0) return { matched: false, reason: "kind_filter" };
    if (!kinds.some((kind) => hook.kinds?.includes(kind as "create" | "modify" | "delete" | "rename"))) {
      return { matched: false, reason: "kind_filter" };
    }
  }
  return { matched: true };
}
