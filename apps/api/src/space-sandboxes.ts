import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { spaceSandboxes } from "./db/schema-v2.js";
import type { SpaceSandboxStatus } from "@cohub/protocol";

export const getSpaceSandboxBySpaceId = async (spaceId: string) => {
  const [sandbox] = await db
    .select()
    .from(spaceSandboxes)
    .where(eq(spaceSandboxes.spaceId, spaceId))
    .limit(1);

  return sandbox ?? null;
};

export const ensureSpaceSandbox = async (input: {
  spaceId: string;
  status?: SpaceSandboxStatus;
  podName?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [sandbox] = await db
    .insert(spaceSandboxes)
    .values({
      spaceId: input.spaceId,
      status: input.status ?? "pending",
      podName: input.podName ?? null,
      meta: input.meta ?? null,
    })
    .onConflictDoUpdate({
      target: spaceSandboxes.spaceId,
      set: {
        status: input.status ?? "pending",
        podName: input.podName ?? null,
        meta: input.meta ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!sandbox) {
    throw new Error("Failed to ensure space sandbox");
  }

  return sandbox;
};

export const updateSpaceSandbox = async (input: {
  spaceId: string;
  status?: SpaceSandboxStatus;
  podName?: string | null;
  lastHeartbeatAt?: Date | null;
  meta?: Record<string, unknown> | null;
}) => {
  const [sandbox] = await db
    .update(spaceSandboxes)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.podName !== undefined ? { podName: input.podName } : {}),
      ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
      updatedAt: new Date(),
    })
    .where(eq(spaceSandboxes.spaceId, input.spaceId))
    .returning();

  return sandbox ?? null;
};
