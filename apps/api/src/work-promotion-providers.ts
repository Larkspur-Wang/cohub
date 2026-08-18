import { isIP } from "node:net";
import type { Context } from "hono";
import { createLogger } from "@cohub/infra/logging";
import type { WorkPromotionEventKey } from "@cohub/protocol";
import { config } from "./config.js";
import { getRequestRemoteAddress, isPrivateNetworkAddress } from "./lib/middleware.js";
import { buildMetaPromotionPayload } from "./work-promotion-meta-payload.js";

export type WorkPromotionProviderKey = "generic" | "meta";

export type WorkPromotionBrowserConfig =
  | { provider: "generic" }
  | { provider: "meta"; pixelId: string };

export type WorkPromotionDeliveryEvent = {
  eventKey: WorkPromotionEventKey;
  eventId: string;
  workId: string;
  promotionId: string;
  sourceUrl?: string;
  fbp?: string;
  fbc?: string;
  productKey?: string;
  value?: number;
  currency?: string;
};

export type WorkPromotionProvider = {
  key: WorkPromotionProviderKey;
  configured: () => boolean;
  browserConfig: () => WorkPromotionBrowserConfig | null;
  deliver: (c: Context, event: WorkPromotionDeliveryEvent) => Promise<void>;
};

const logger = createLogger({ serviceName: "cohub-api" });

function resolveClientIp(c: Context) {
  const raw = config.metaPromotionClientIpHeader
    ? c.req.header(config.metaPromotionClientIpHeader)?.split(",")[0]
    : getRequestRemoteAddress(c);
  const value = raw?.trim().replace(/^::ffff:/, "");
  if (!value || isIP(value) === 0 || isPrivateNetworkAddress(value)) return undefined;
  return value;
}

function resolveSourceUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const expectedOrigin = (config.webOrigin ?? (config.env === "prod" ? "https://cohub.live" : "https://dev.cohub.live")).replace(/\/+$/, "");
    return url.origin === expectedOrigin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const genericProvider: WorkPromotionProvider = {
  key: "generic",
  configured: () => true,
  browserConfig: () => ({ provider: "generic" }),
  deliver: async () => undefined,
};

const META_EVENT_NAMES: Partial<Record<WorkPromotionEventKey, string>> = {
  ready: "ViewContent",
  registration_completed: "CompleteRegistration",
  paywall_viewed: "AddToCart",
  checkout_started: "InitiateCheckout",
};

const metaProvider: WorkPromotionProvider = {
  key: "meta",
  configured: () => Boolean(config.metaPromotionPixelId && config.metaPromotionAccessToken),
  browserConfig: () => config.metaPromotionPixelId && config.metaPromotionAccessToken
    ? { provider: "meta", pixelId: config.metaPromotionPixelId }
    : null,
  deliver: async (c, event) => {
    const eventName = META_EVENT_NAMES[event.eventKey];
    if (!eventName || !config.metaPromotionPixelId || !config.metaPromotionAccessToken) return;
    const userAgent = c.req.header("user-agent")?.trim();
    const clientIp = resolveClientIp(c);
    const sourceUrl = resolveSourceUrl(event.sourceUrl);
    const userData = {
      ...(clientIp ? { client_ip_address: clientIp } : {}),
      ...(userAgent ? { client_user_agent: userAgent } : {}),
      ...(event.fbp ? { fbp: event.fbp } : {}),
      ...(event.fbc ? { fbc: event.fbc } : {}),
    };
    const customData = {
      ...(event.productKey ? { content_ids: [event.productKey], content_type: "product" } : {}),
      ...(event.value !== undefined ? { value: event.value } : {}),
      ...(event.currency ? { currency: event.currency } : {}),
    };
    const endpoint = `https://graph.facebook.com/${config.metaPromotionApiVersion}/${encodeURIComponent(config.metaPromotionPixelId)}/events`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.metaPromotionAccessToken}`,
        },
        body: JSON.stringify(buildMetaPromotionPayload({
          eventName,
          eventTime: Math.floor(Date.now() / 1000),
          event,
          sourceUrl,
          userData,
          customData,
          testEventCode: config.metaPromotionTestEventCode,
        })),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        logger.warn("[WorkPromotions] Meta delivery rejected", {
          status: response.status,
          eventKey: event.eventKey,
        });
      }
    } catch (error) {
      logger.warn("[WorkPromotions] Meta delivery failed", {
        eventKey: event.eventKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

const providers = new Map<WorkPromotionProviderKey, WorkPromotionProvider>([
  [genericProvider.key, genericProvider],
  [metaProvider.key, metaProvider],
]);

export function getWorkPromotionProvider(value: string): WorkPromotionProvider | null {
  return providers.get(value as WorkPromotionProviderKey) ?? null;
}

export function listWorkPromotionProviders() {
  return Array.from(providers.values(), (provider) => ({
    key: provider.key,
    configured: provider.configured(),
  }));
}
