import { Redis } from "ioredis";
import { config } from "./config.js";

export const STREAM_MAXLEN = 2000;
export const STREAM_APPROX = "~";
export const SPACE_EVENTS_STREAM = "stream:space:events";

export const redisCommandClient = new Redis(config.redisUrl);
