import { randomUUID } from "node:crypto";
import { redisCommandClient } from "./redis.js";

export const SANDBOX_EVENTS_CHANNEL = "pubsub:sandbox:events";

export type SandboxLifecycleEvent = {
  id: string;
  type: "sandbox.replacing";
  spaceId: string;
  reason: string;
  source?: string | null;
  generation?: string | null;
  podName?: string | null;
  podIp?: string | null;
  timestamp: number;
};

export async function publishSandboxLifecycleEvent(input: Omit<SandboxLifecycleEvent, "id" | "timestamp">) {
  const event: SandboxLifecycleEvent = {
    id: randomUUID(),
    timestamp: Date.now(),
    ...input,
  };
  await redisCommandClient.publish(SANDBOX_EVENTS_CHANNEL, JSON.stringify(event));
  return event;
}
