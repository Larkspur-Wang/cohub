import { decodeAppViewStatsRedisField } from "@cohub/protocol";

export type AppViewStatsBatchRow = {
  appId: string;
  appVersionId: string;
  bucketStartAt: Date;
  source: string;
  viewCount: number;
  updatedAt: Date;
};

export function parseAppViewStatsBatch(
  hash: Record<string, string>,
  now = new Date(),
): { rows: AppViewStatsBatchRow[]; invalid: number } {
  const rows: AppViewStatsBatchRow[] = [];
  let invalid = 0;
  for (const [field, rawCount] of Object.entries(hash)) {
    const dimensions = decodeAppViewStatsRedisField(field);
    const viewCount = Number(rawCount);
    if (!dimensions || !Number.isSafeInteger(viewCount) || viewCount <= 0) {
      invalid += 1;
      continue;
    }
    rows.push({
      appId: dimensions.appId,
      appVersionId: dimensions.appVersionId,
      bucketStartAt: new Date(dimensions.bucketStartAtMs),
      source: dimensions.source,
      viewCount,
      updatedAt: now,
    });
  }
  return { rows, invalid };
}
