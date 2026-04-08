import { Redis } from "ioredis";
import { config } from "./config.js";

export type RedisStreamEntry = [string, string[]];

// Stream 长度限制配置
export const STREAM_MAXLEN = 10000;
export const STREAM_APPROX = "~";

/**
 * Shared command client for short-lived, non-blocking Redis commands only.
 */
export const redisCommandClient = new Redis(config.redisUrl);

export const createBlockingRedisClient = () => {
  const client = redisCommandClient.duplicate({ lazyConnect: true });
  return client;
};

export const createStreamingRedisClient = () => {
  const client = redisCommandClient.duplicate({ lazyConnect: true });
  return client;
};

export const isRedisReady = async () => {
  try {
    const pong = await redisCommandClient.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
};

const redisRuntimePrefix = (runtimeId: string) => `runtimes:${runtimeId}`;

export const getRuntimeMetaKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:meta`;

export const getRuntimeInputQueueKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:input_queue`;

export const getRuntimeOutputStreamKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:output_stream`;

// Gateway Stream Keys
export const GATEWAY_INBOUND_STREAM = "stream:gateway:inbound";
export const GATEWAY_OUTBOUND_STREAM = "stream:gateway:outbound";
export const GATEWAY_LOGS_STREAM = "stream:gateway:logs";

// Consumer Groups
export const INBOUND_CONSUMER_GROUP = "api-inbound-consumers";
export const LOG_CONSUMER_GROUP = "api-loggers";

export const xaddWithMaxlen = async (client: Redis, streamKey: string, ...args: (string | number)[]) => {
  return client.xadd(streamKey, "MAXLEN", STREAM_APPROX, STREAM_MAXLEN, ...args);
};

export const ensureConsumerGroup = async (
  streamKey: string,
  groupName: string,
  startId = "0",
) => {
  try {
    await redisCommandClient.xgroup("CREATE", streamKey, groupName, startId, "MKSTREAM");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("BUSYGROUP")) throw err;
  }
};

export const checkPendingMessages = async (streamKey: string, groupName: string) => {
  try {
    const pending = await redisCommandClient.xpending(streamKey, groupName);
    return { total: pending?.[0] ? Number(pending[0]) : 0 };
  } catch {
    return { total: 0 };
  }
};

export const getStreamInfo = async (streamKey: string) => {
  try {
    const info = await redisCommandClient.xinfo("STREAM", streamKey) as (string | number)[];
    const lengthIdx = info.findIndex((item) => item === "length");
    return { length: lengthIdx >= 0 ? Number(info[lengthIdx + 1]) : 0, exists: true };
  } catch {
    return { length: 0, exists: false };
  }
};
