import type {
  ChannelHealth,
  ChannelHealthReasonCode,
  ChannelRuntimeState,
} from "@cohub/protocol/gateway";
import { redisCommandClient } from "./redis.js";

const healthKey = (channelId: string) => `gateway:channel:${channelId}:health`;

function parseHealthHash(raw: Record<string, string> | null | undefined): ChannelHealth | null {
  if (!raw || Object.keys(raw).length === 0) return null;

  const state = (raw.state as ChannelRuntimeState | undefined) ?? "connecting";
  let meta: Record<string, string> | null = null;
  if (raw.meta) {
    try {
      const parsed = JSON.parse(raw.meta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter(([, value]) => value != null && String(value).trim())
            .map(([key, value]) => [key, String(value)]),
        );
      }
    } catch {
      meta = null;
    }
  }

  return {
    state,
    reasonCode: (raw.reasonCode as ChannelHealthReasonCode | undefined) || null,
    message: raw.message?.trim() || null,
    detail: raw.detail?.trim() || null,
    lastReadyAt: raw.lastReadyAt?.trim() || null,
    lastErrorAt: raw.lastErrorAt?.trim() || null,
    lastInboundAt: raw.lastInboundAt?.trim() || null,
    lastOutboundAt: raw.lastOutboundAt?.trim() || null,
    nodeId: raw.nodeId?.trim() || null,
    updatedAt: raw.updatedAt?.trim() || new Date(0).toISOString(),
    meta,
  };
}

/** When a channel is bound but has never reported health, surface connecting. */
export function fallbackBoundChannelHealth(): ChannelHealth {
  return {
    state: "connecting",
    reasonCode: null,
    message: null,
    detail: null,
    lastReadyAt: null,
    lastErrorAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    nodeId: null,
    updatedAt: new Date(0).toISOString(),
    meta: null,
  };
}

export async function getChannelHealthMap(channelIds: string[]): Promise<Map<string, ChannelHealth | null>> {
  const uniqueIds = Array.from(new Set(channelIds.filter((id) => Boolean(id?.trim()))));
  const result = new Map<string, ChannelHealth | null>();
  if (uniqueIds.length === 0) return result;

  const pipeline = redisCommandClient.pipeline();
  for (const channelId of uniqueIds) {
    pipeline.hgetall(healthKey(channelId));
  }
  const rows = await pipeline.exec();

  uniqueIds.forEach((channelId, index) => {
    const entry = rows?.[index];
    const raw = entry && entry[0] == null ? (entry[1] as Record<string, string>) : null;
    result.set(channelId, parseHealthHash(raw));
  });

  return result;
}

export async function clearChannelHealth(channelId: string) {
  if (!channelId.trim()) return;
  await redisCommandClient.del(healthKey(channelId)).catch(() => undefined);
}
