import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { workPromotions, works } from "@cohub/db";
import {
  encodeWorkPromotionStatsRedisField,
  WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  type WorkPromotionEventKey,
} from "@cohub/protocol";
import { db } from "./db/index.js";
import { getWorkPromotionProvider } from "./work-promotion-providers.js";

function toUtcHour(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
}

export async function resolvePublishedWorkPromotion(workId: string, promotionId: string) {
  const [row] = await db.select({ promotion: workPromotions, work: works })
    .from(workPromotions)
    .innerJoin(works, eq(works.id, workPromotions.workId))
    .where(and(eq(workPromotions.id, promotionId), eq(workPromotions.workId, workId)))
    .limit(1);
  if (row?.work.status !== "published" || !row.work.currentVersionId) return null;
  return {
    promotion: row.promotion,
    work: { ...row.work, currentVersionId: row.work.currentVersionId },
  };
}

export function recordResolvedWorkPromotionEvent(
  c: Context,
  input: {
    promotion: typeof workPromotions.$inferSelect;
    workVersionId: string;
    eventKey: WorkPromotionEventKey;
    eventId: string;
    sourceUrl?: string;
    fbp?: string;
    fbc?: string;
    productKey?: string;
    value?: number;
    currency?: string;
    recordStats?: boolean;
  },
) {
  const provider = getWorkPromotionProvider(input.promotion.provider);
  if (!provider) return null;
  if (input.recordStats !== false) {
    const bucketStartAt = toUtcHour(new Date());
    void import("./redis.js").then(({ redisBestEffortCommandClient }) => {
      if (redisBestEffortCommandClient.status !== "ready") return;
      return redisBestEffortCommandClient.hincrby(
        WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
        encodeWorkPromotionStatsRedisField({
          promotionId: input.promotion.id,
          workVersionId: input.workVersionId,
          bucketStartAtMs: bucketStartAt.getTime(),
          eventKey: input.eventKey,
        }),
        1,
      );
    }).catch(() => undefined);
  }
  void provider.deliver(c, {
    eventKey: input.eventKey,
    eventId: input.eventId,
    workId: input.promotion.workId,
    promotionId: input.promotion.id,
    sourceUrl: input.sourceUrl,
    fbp: input.fbp,
    fbc: input.fbc,
    productKey: input.productKey,
    value: input.value,
    currency: input.currency,
  });
  return provider.browserConfig();
}
