import type { AppPromotionEventKey } from "@cohub/protocol";

export type MetaPromotionDeliveryEvent = {
  eventKey: AppPromotionEventKey;
  eventId: string;
  appId: string;
  promotionId: string;
  sourceUrl?: string;
  fbp?: string;
  fbc?: string;
  productKey?: string;
  value?: number;
  currency?: string;
};

export function buildMetaPromotionPayload(input: {
  eventName: string;
  eventTime: number;
  event: MetaPromotionDeliveryEvent;
  sourceUrl?: string;
  userData: Record<string, string>;
  customData: Record<string, unknown>;
  testEventCode?: string;
}) {
  return {
    data: [{
      event_name: input.eventName,
      event_time: input.eventTime,
      event_id: input.event.eventId,
      action_source: "website",
      ...(input.sourceUrl ? { event_source_url: input.sourceUrl } : {}),
      user_data: input.userData,
      custom_data: Object.keys(input.customData).length > 0
        ? input.customData
        : { content_ids: [input.event.appId], content_type: "product" },
    }],
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  };
}
