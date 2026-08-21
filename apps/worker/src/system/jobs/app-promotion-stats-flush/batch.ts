import { decodeAppPromotionStatsRedisField } from "@cohub/protocol";

export type AppPromotionStatsBatchRow = {
  promotionId: string;
  appVersionId: string;
  bucketStartAt: Date;
  eventKey: string;
  eventCount: number;
  updatedAt: Date;
};

export function parseAppPromotionStatsBatch(
  hash: Record<string, string>,
  now = new Date(),
): { rows: AppPromotionStatsBatchRow[]; invalid: number } {
  const rows: AppPromotionStatsBatchRow[] = [];
  let invalid = 0;
  for (const [field, rawCount] of Object.entries(hash)) {
    const dimensions = decodeAppPromotionStatsRedisField(field);
    const eventCount = Number(rawCount);
    if (!dimensions || !Number.isSafeInteger(eventCount) || eventCount <= 0) {
      invalid += 1;
      continue;
    }
    rows.push({
      promotionId: dimensions.promotionId,
      appVersionId: dimensions.appVersionId,
      bucketStartAt: new Date(dimensions.bucketStartAtMs),
      eventKey: dimensions.eventKey,
      eventCount,
      updatedAt: now,
    });
  }
  return { rows, invalid };
}
