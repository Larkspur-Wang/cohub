import type { SpaceFsChange } from "@cohub/protocol/fs";
import { getMimeType } from "./space-fs.js";
import { enqueueFsCdnWarmForMeta, shouldUseFsCdnForMeta } from "./space-fs-cdn-cache.js";

export async function enqueueFsCdnWarmForChanges(spaceId: string, changes: SpaceFsChange[]) {
  await Promise.allSettled(
    changes.map(async (change) => {
      if ((change.kind !== "create" && change.kind !== "modify") || change.nodeType !== "file") return;
      if (!change.path || change.size == null || change.mtimeMs == null) return;
      const mimeType = getMimeType(change.path);
      const meta = {
        spaceId,
        path: change.path,
        name: change.path.split("/").pop() ?? "file",
        size: change.size,
        mimeType,
        mtimeMs: change.mtimeMs,
      };
      if (!shouldUseFsCdnForMeta(meta)) return;
      await enqueueFsCdnWarmForMeta(meta, "fs_changed");
    }),
  );
}
