import type { HarnessArchive } from "@cohub/protocol";
import { persistHarnessArchive } from "../persistence.js";
import { logger } from "../logger.js";

const pending = new Set<Promise<unknown>>();
const MAX_PENDING = 8;
// Object storage keeps only small snapshots; anything larger stays on the native host.
const ARCHIVE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;

/** Native files remain the recovery copy until best-effort object archival succeeds. */
export function scheduleHarnessArchive(spaceId: string, snapshot: () => HarnessArchive) {
  if (pending.size >= MAX_PENDING) {
    logger.warn("[HarnessArchive] upload capacity reached; native file retained");
    return;
  }
  // Capture while the execution still owns its session. Never serialize a live handle later.
  const archive = snapshot();
  if (Buffer.byteLength(archive.data) > ARCHIVE_UPLOAD_MAX_BYTES) {
    logger.warn("[HarnessArchive] native snapshot exceeds upload limit; native file retained", { turnId: archive.turnId });
    return;
  }
  const task = persistHarnessArchive(spaceId, archive)
    .catch((error) => logger.warn("[HarnessArchive] background upload failed; native file retained", error))
    .finally(() => pending.delete(task));
  pending.add(task);
}

export async function drainHarnessArchives() { await Promise.allSettled([...pending]); }
