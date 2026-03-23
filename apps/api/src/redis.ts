import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl);

const redisRuntimePrefix = (runtimeId: string) => `runtimes:${runtimeId}`;
const redisRuntimeSessionPrefix = (runtimeId: string, runtimeSessionId: string) =>
  `${redisRuntimePrefix(runtimeId)}:sessions:${runtimeSessionId}`;

export const getRuntimeMetaKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:meta`;

export const getRuntimeInputQueueKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:input_queue`;

export const getRuntimeOutputStreamKey = (runtimeId: string) =>
  `${redisRuntimePrefix(runtimeId)}:output_stream`;

export const getRuntimeSessionMetaKey = (
  runtimeId: string,
  runtimeSessionId: string,
) => `${redisRuntimeSessionPrefix(runtimeId, runtimeSessionId)}:meta`;

export const getRuntimeSessionOutputStreamKey = (
  runtimeId: string,
  runtimeSessionId: string,
) => `${redisRuntimeSessionPrefix(runtimeId, runtimeSessionId)}:output_stream`;
