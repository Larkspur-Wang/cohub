import type { CheckpointDiffStatus } from "@cohub/protocol/fs";

function parseStatusCode(raw: string): CheckpointDiffStatus | null {
  const code = raw.trim().charAt(0).toUpperCase();
  if (code === "A" || code === "M" || code === "D" || code === "R" || code === "C" || code === "T") {
    return code;
  }
  return null;
}

/** Parse `git diff -z --name-status` output into file entries. */
export function parseNameStatus(output: Buffer): Array<{
  status: CheckpointDiffStatus;
  path: string;
  oldPath?: string;
}> {
  const parts = output.toString("utf8").split("\0").filter((part) => part.length > 0);
  const files: Array<{ status: CheckpointDiffStatus; path: string; oldPath?: string }> = [];
  let index = 0;
  while (index < parts.length) {
    const statusToken = parts[index] ?? "";
    const status = parseStatusCode(statusToken);
    if (!status) {
      index += 1;
      continue;
    }
    if (status === "R" || status === "C") {
      const oldPath = parts[index + 1] ?? "";
      const path = parts[index + 2] ?? "";
      if (path) files.push({ status, path, oldPath: oldPath || undefined });
      index += 3;
      continue;
    }
    const path = parts[index + 1] ?? "";
    if (path) files.push({ status, path });
    index += 2;
  }
  return files;
}

/**
 * Parse `git diff -z --numstat` into a path → {additions, deletions, binary} map.
 *
 * NUL-delimited formats:
 * - normal:  `12\t3\tpath\0`
 * - rename:  `0\t0\t\0old.ts\0new.ts\0`  (stats field ends with trailing tab, paths are separate fields)
 * - copy:    same as rename
 */
export function parseNumstat(output: Buffer): Map<string, { additions: number | null; deletions: number | null; binary: boolean }> {
  const map = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();
  // Keep empty fields — rename stats arrive as "0\t0\t" then separate path fields.
  const parts = output.toString("utf8").split("\0");
  let index = 0;
  while (index < parts.length) {
    const part = parts[index] ?? "";
    if (!part) {
      index += 1;
      continue;
    }
    const tabs = part.split("\t");
    // Need at least added + deleted + a path slot (may be empty for rename).
    if (tabs.length < 3) {
      index += 1;
      continue;
    }
    const addedRaw = tabs[0] ?? "";
    const deletedRaw = tabs[1] ?? "";
    // Reject non-numstat tokens (e.g. bare paths left over from a prior mis-parse).
    if (addedRaw !== "-" && Number.isNaN(Number.parseInt(addedRaw, 10))) {
      index += 1;
      continue;
    }
    const binary = addedRaw === "-" || deletedRaw === "-";
    const additions = binary ? null : Number.parseInt(addedRaw, 10);
    const deletions = binary ? null : Number.parseInt(deletedRaw, 10);
    const pathField = tabs.slice(2).join("\t"); // usually empty for rename, or the path for normal

    let path = pathField;
    if (!path) {
      // Rename/copy: next two non-empty fields are oldPath, newPath.
      const oldPath = parts[index + 1] ?? "";
      const newPath = parts[index + 2] ?? "";
      path = newPath || oldPath;
      index += 3;
    } else {
      index += 1;
    }
    if (!path) continue;
    map.set(path, {
      additions: Number.isFinite(additions as number) ? (additions as number) : null,
      deletions: Number.isFinite(deletions as number) ? (deletions as number) : null,
      binary,
    });
  }
  return map;
}
