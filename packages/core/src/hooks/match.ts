import type { SpaceHookDefinition, SpaceHookEventEnvelope } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function matchGlob(pattern: string, value: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedValue = normalizePath(value);
  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return normalizedPattern === normalizedValue
      || normalizedValue.startsWith(`${normalizedPattern}/`);
  }

  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: sentinel for ** glob
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalizedValue)
    || new RegExp(`^${escaped}/`).test(`${normalizedValue}/`);
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
    return { matched: true, reason: "fs_resync" };
  }
  if (paths.length === 0) {
    return { matched: false, reason: "no_paths" };
  }

  const activePaths = paths.filter((path) => !isIgnored(hook.ignore, [path]));
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
