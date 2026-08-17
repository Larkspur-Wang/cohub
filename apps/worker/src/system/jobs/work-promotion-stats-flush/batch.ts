import { decodeWorkPromotionStatsRedisField } from "@cohub/protocol";

export type WorkPromotionStatsBatchRow = {
  promotionId: string;
  workVersionId: string;
  bucketStartAt: Date;
  eventKey: string;
  eventCount: number;
  updatedAt: Date;
};

export function parseWorkPromotionStatsBatch(
  hash: Record<string, string>,
  now = new Date(),
): { rows: WorkPromotionStatsBatchRow[]; invalid: number } {
  const rows: WorkPromotionStatsBatchRow[] = [];
  let invalid = 0;
  for (const [field, rawCount] of Object.entries(hash)) {
    const dimensions = decodeWorkPromotionStatsRedisField(field);
    const eventCount = Number(rawCount);
    if (!dimensions || !Number.isSafeInteger(eventCount) || eventCount <= 0) {
      invalid += 1;
      continue;
    }
    rows.push({
      promotionId: dimensions.promotionId,
      workVersionId: dimensions.workVersionId,
      bucketStartAt: new Date(dimensions.bucketStartAtMs),
      eventKey: dimensions.eventKey,
      eventCount,
      updatedAt: now,
    });
  }
  return { rows, invalid };
}
