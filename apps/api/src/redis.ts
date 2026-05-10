import { Redis } from "ioredis";
import { config } from "./config.js";

export const redisCommandClient = new Redis(config.redisUrl);

export const isRedisReady = async () => {
  try {
    const pong = await redisCommandClient.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
};

export const getAgentInstanceInputQueueKey = (instanceId: string) =>
  `agent:instance:${instanceId}:input_queue`;

export const GATEWAY_OUTBOUND_STREAM = "stream:gateway:outbound";
export const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";

export const getSpaceWsUsersKey = (spaceId: string) => `realtime:space:${spaceId}:ws_users`;
export const getSpaceWsUsersUpdatedAtKey = (spaceId: string) => `realtime:space:${spaceId}:ws_users:updated_at`;

export const xaddWithMaxlen = async (client: Redis, streamKey: string, ...args: (string | number)[]) => {
  return client.xadd(streamKey, "MAXLEN", "~", 2000, ...args);
};
