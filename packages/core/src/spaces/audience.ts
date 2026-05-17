import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { spaceMembers, spaces } from "@cohub/db";

type DrizzleDb = PostgresJsDatabase<Record<string, unknown>>;

type RedisPipeline = {
  del(key: string): unknown;
  sadd(key: string, ...members: string[]): unknown;
  set(key: string, value: string): unknown;
  exec(): Promise<unknown>;
};

type RedisPipelineClient = {
  pipeline(): RedisPipeline;
};

const defaultKeys = {
  spaceWsUsers: (spaceId: string) => `realtime:space:${spaceId}:ws_users`,
  spaceWsUsersUpdatedAt: (spaceId: string) => `realtime:space:${spaceId}:ws_users:updated_at`,
};

export async function getReadableUserIdsForSpace(input: {
  db: DrizzleDb;
  spaceId: string;
}) {
  const [space] = await input.db.select({ ownerId: spaces.userUuid }).from(spaces).where(eq(spaces.id, input.spaceId)).limit(1);
  const members = await input.db
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, input.spaceId));
  const userIds = new Set<string>();
  if (space?.ownerId) userIds.add(space.ownerId);
  for (const member of members) if (member.userId) userIds.add(member.userId);
  return Array.from(userIds);
}

export async function recomputeSpaceWsUsers(input: {
  db: DrizzleDb;
  redis: RedisPipelineClient;
  spaceId: string;
  userIds?: string[];
  keys?: typeof defaultKeys;
}) {
  const keys = input.keys ?? defaultKeys;
  const readableUserIds = input.userIds ?? await getReadableUserIdsForSpace({ db: input.db, spaceId: input.spaceId });
  const key = keys.spaceWsUsers(input.spaceId);
  const pipeline = input.redis.pipeline();
  pipeline.del(key);
  if (readableUserIds.length > 0) pipeline.sadd(key, ...readableUserIds);
  pipeline.set(keys.spaceWsUsersUpdatedAt(input.spaceId), String(Date.now()));
  await pipeline.exec();
  return readableUserIds;
}
