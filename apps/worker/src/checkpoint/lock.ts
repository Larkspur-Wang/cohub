import { redisCommandClient } from "../redis.js";

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export async function withSpaceSaveLock<T>(spaceId: string, fn: () => Promise<T>): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const key = `cohub:space:${spaceId}:save-checkpoint`;
  const token = crypto.randomUUID();
  const ttlMs = 30 * 60 * 1000;
  const acquired = await redisCommandClient.set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return { acquired: false };

  const heartbeat = setInterval(() => {
    void redisCommandClient.eval(EXTEND_SCRIPT, 1, key, token, String(ttlMs)).catch(() => undefined);
  }, Math.floor(ttlMs / 3));
  heartbeat.unref?.();

  try {
    return { acquired: true, result: await fn() };
  } finally {
    clearInterval(heartbeat);
    await redisCommandClient.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
