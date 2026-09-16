import { randomUUID } from "node:crypto";
import { link, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** Validate before publishing; an interrupted restore must not leave a partial live projection. */
export async function restoreCloudSnapshot(path: string, data: string, sessionId: string): Promise<void> {
  const lines = data.split("\n").filter((line) => line.trim());
  const entries: unknown[] = lines.map((line) => JSON.parse(line));
  const header = entries[0] as { type?: string; id?: string } | undefined;
  if (header?.type !== "session" || header.id !== sessionId) throw new Error("Cloud archive session identity mismatch");
  const temporary = `${path}.${randomUUID()}.restoring`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    // Hard-link publishes atomically without replacing a projection created by another owner.
    await link(temporary, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}
