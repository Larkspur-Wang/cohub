import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { appPromotions, apps } from "@cohub/db";
import {
  encodeAppPromotionStatsRedisField,
  APP_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  type AppPromotionEventKey,
} from "@cohub/protocol";
import { db } from "./db/index.js";
import { getAppPromotionProvider } from "./app-promotion-providers.js";

function toUtcHour(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
}

export async function resolvePublishedAppPromotion(appId: string, promotionId: string) {
  const [row] = await db.select({ promotion: appPromotions, app: apps })
    .from(appPromotions)
    .innerJoin(apps, eq(apps.id, appPromotions.appId))
    .where(and(eq(appPromotions.id, promotionId), eq(appPromotions.appId, appId)))
    .limit(1);
  if (row?.app.status !== "published" || !row.app.currentVersionId) return null;
  return {
    promotion: row.promotion,
    app: { ...row.app, currentVersionId: row.app.currentVersionId },
  };
}

export function recordResolvedAppPromotionEvent(
  c: Context,
  input: {
    promotion: typeof appPromotions.$inferSelect;
    appVersionId: string;
    eventKey: AppPromotionEventKey;
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
  const provider = getAppPromotionProvider(input.promotion.provider);
  if (!provider) return null;
  if (input.recordStats !== false) {
    const bucketStartAt = toUtcHour(new Date());
    void import("./redis.js").then(({ redisBestEffortCommandClient }) => {
      if (redisBestEffortCommandClient.status !== "ready") return;
      return redisBestEffortCommandClient.hincrby(
        APP_PROMOTION_STATS_ACTIVE_REDIS_KEY,
        encodeAppPromotionStatsRedisField({
          promotionId: input.promotion.id,
          appVersionId: input.appVersionId,
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
    appId: input.promotion.appId,
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
