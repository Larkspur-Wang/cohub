import { isIP } from "node:net";
import type { Context } from "hono";
import { createLogger } from "@cohub/infra/logging";
import { config } from "./config.js";
import { getRequestRemoteAddress, isPrivateNetworkAddress } from "./lib/middleware.js";

export type WorkPromotionProviderKey = "generic" | "meta";

export type WorkPromotionBrowserConfig =
  | { provider: "generic" }
  | { provider: "meta"; pixelId: string };

export type WorkPromotionDeliveryEvent = {
  eventKey: "landing" | "ready";
  eventId: string;
  workId: string;
  promotionId: string;
  sourceUrl?: string;
  fbp?: string;
  fbc?: string;
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

const metaProvider: WorkPromotionProvider = {
  key: "meta",
  configured: () => Boolean(config.metaPromotionPixelId && config.metaPromotionAccessToken),
  browserConfig: () => config.metaPromotionPixelId && config.metaPromotionAccessToken
    ? { provider: "meta", pixelId: config.metaPromotionPixelId }
    : null,
  deliver: async (c, event) => {
    if (event.eventKey !== "ready" || !config.metaPromotionPixelId || !config.metaPromotionAccessToken) return;
    const userAgent = c.req.header("user-agent")?.trim();
    const clientIp = resolveClientIp(c);
    const sourceUrl = resolveSourceUrl(event.sourceUrl);
    const userData = {
      ...(clientIp ? { client_ip_address: clientIp } : {}),
      ...(userAgent ? { client_user_agent: userAgent } : {}),
      ...(event.fbp ? { fbp: event.fbp } : {}),
      ...(event.fbc ? { fbc: event.fbc } : {}),
    };
    const endpoint = `https://graph.facebook.com/${config.metaPromotionApiVersion}/${encodeURIComponent(config.metaPromotionPixelId)}/events`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.metaPromotionAccessToken}`,
        },
        body: JSON.stringify({
          data: [{
            event_name: "ViewContent",
            event_time: Math.floor(Date.now() / 1000),
            event_id: event.eventId,
            action_source: "website",
            ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
            user_data: userData,
            custom_data: {
              content_ids: [event.workId],
              content_type: "product",
            },
          }],
        }),
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
