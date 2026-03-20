import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl);

const redisSessionPrefix = (sessionId: string) =>
  `netaverses:sessions:${sessionId}`;

export const getSessionMetaKey = (sessionId: string) =>
  `${redisSessionPrefix(sessionId)}:meta`;
export const getSessionInputQueueKey = (sessionId: string) =>
  `${redisSessionPrefix(sessionId)}:input_queue`;
export const getSessionOutputStreamKey = (sessionId: string) =>
  `${redisSessionPrefix(sessionId)}:output_stream`;
