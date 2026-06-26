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

export const getGatewayNodeOutboundStreamKey = (nodeId: string) => `stream:gateway:node:${nodeId}:outbound`;
export const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";

export const xaddWithMaxlen = async (client: Redis, streamKey: string, ...args: (string | number)[]) => {
  return client.xadd(streamKey, "MAXLEN", "~", 2000, ...args);
};
