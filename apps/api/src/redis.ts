import { Redis } from "ioredis";
import { config } from "./config.js";

export type RedisStreamEntry = [string, string[]];

/**
 * Shared command client for short-lived, non-blocking Redis commands only.
 *
 * Safe examples:
 * - HSET / HGET / HGETALL
 * - XADD / XREVRANGE
 * - RPUSH
 * - ZRANGEBYSCORE
 *
 * Do NOT use this client for blocking commands such as:
 * - XREAD BLOCK
 * - SUBSCRIBE / PSUBSCRIBE
 *
 * Those commands occupy the connection and can starve normal request traffic.
 */
export const redisCommandClient = new Redis(config.redisUrl);

/**
 * Creates a dedicated Redis connection for long-lived blocking consumers.
 *
 * Intended for commands like:
 * - XREAD BLOCK 0
 * - SUBSCRIBE / PSUBSCRIBE
 */
export const createBlockingRedisClient = () => {
  const client = redisCommandClient.duplicate();
  return client;
};

/**
 * Creates a dedicated Redis connection for streaming/read-loop style access.
 *
 * Intended for per-request or per-session stream readers that may stay open
 * for a while and should not share the main command connection.
 */
export const createStreamingRedisClient = () => {
  const client = redisCommandClient.duplicate();
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
const redisRuntimeSessionPrefix = (runtimeId: string, runtimeSessionId: string) =>
  `${redisRuntimePrefix(runtimeId)}:sessions:${runtimeSessionId}`;

export const getRuntimeMetaKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:meta`;

export const getRuntimeInputQueueKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:input_queue`;

export const getRuntimeOutputStreamKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:output_stream`;

export const getRuntimeProvisionMetaKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:provision:meta`;

export const getRuntimeProvisionStreamKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:provision:stream`;

export const getRuntimeSessionMetaKey = (
  runtimeId: string,
  runtimeSessionId: string,
) => `${redisRuntimeSessionPrefix(runtimeId, runtimeSessionId)}:meta`;

export const getRuntimeSessionOutputStreamKey = (
  runtimeId: string,
  runtimeSessionId: string,
) => `${redisRuntimeSessionPrefix(runtimeId, runtimeSessionId)}:output_stream`;
