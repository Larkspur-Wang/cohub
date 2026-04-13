import { and, isNull, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import { resourcePermissions, runtimes } from "./db/schema.js";
import type { AuthUserProfile } from "./auth.js";
import type { ResourcePermissionLevel } from "@cohub/protocol";

const READABLE_LEVELS: ResourcePermissionLevel[] = ["read", "write"];
const WRITABLE_LEVELS: ResourcePermissionLevel[] = ["write"];

/**
 * 从权限记录列表中查找对指定资源有效的权限。
 * 优先级：用户级 (granteeUuid = userUuid) > 公共级 (granteeUuid = NULL)
 */
const findEffectivePermission = (
  perms: typeof resourcePermissions.$inferSelect[],
  resourceType: "runtime" | "session",
  resourceId: string,
  userUuid: string | null,
): typeof resourcePermissions.$inferSelect | null => {
  // 优先匹配用户级权限
  if (userUuid) {
    const userPerm = perms.find(
      (p) =>
        p.resourceType === resourceType &&
        p.resourceId === resourceId &&
        p.granteeUuid === userUuid,
    );
    if (userPerm) return userPerm;
  }

  // 再 fallback 公共权限
  const publicPerm = perms.find(
    (p) =>
      p.resourceType === resourceType &&
      p.resourceId === resourceId &&
      p.granteeUuid === null,
  );
  return publicPerm ?? null;
};

/**
 * 判断用户（或匿名）是否对指定资源有读权限。
 * - Owner 始终返回 true
 * - Session 级记录优先于 Runtime 级
 * - 不在表中 = 无权限
 * - level="private" 表示明确拒绝，不 fallback
 */
export const canRead = async (
  user: AuthUserProfile | null,
  runtimeId: string,
  sessionId?: string,
): Promise<boolean> => {
  // Owner 始终可访问
  if (user?.uuid) {
    const [runtime] = await db
      .select({ userUuid: runtimes.userUuid })
      .from(runtimes)
      .where(inArray(runtimes.id, [runtimeId]))
      .limit(1);
    if (runtime?.userUuid === user.uuid) return true;
  }

  // 一次查询：同时查 session 级和 runtime 级
  const resourceIds = [runtimeId, ...(sessionId ? [sessionId] : [])];
  const perms = await db
    .select()
    .from(resourcePermissions)
    .where(and(
      inArray(resourcePermissions.resourceType, ["session", "runtime"]),
      inArray(resourcePermissions.resourceId, resourceIds),
    ));

  // session 级优先
  if (sessionId) {
    const sessionPerm = findEffectivePermission(perms, "session", sessionId, user?.uuid ?? null);
    if (sessionPerm) {
      return READABLE_LEVELS.includes(sessionPerm.level as ResourcePermissionLevel);
    }
  }

  // fallback runtime 级
  const runtimePerm = findEffectivePermission(perms, "runtime", runtimeId, user?.uuid ?? null);
  if (runtimePerm) {
    return READABLE_LEVELS.includes(runtimePerm.level as ResourcePermissionLevel);
  }

  return false;
};

/**
 * 便捷包装：检查某个 session 是否可读。
 * 用于 sessions 列表的逐条过滤。
 */
export const canReadForSession = async (
  user: AuthUserProfile | null,
  runtimeId: string,
  sessionId: string,
): Promise<boolean> => {
  return canRead(user, runtimeId, sessionId);
};

export const canWrite = async (
  user: AuthUserProfile | null,
  runtimeId: string,
  sessionId?: string,
): Promise<boolean> => {
  if (!user?.uuid) return false;

  const [runtime] = await db
    .select({ userUuid: runtimes.userUuid })
    .from(runtimes)
    .where(inArray(runtimes.id, [runtimeId]))
    .limit(1);
  if (runtime?.userUuid === user.uuid) return true;

  const resourceIds = [runtimeId, ...(sessionId ? [sessionId] : [])];
  const perms = await db
    .select()
    .from(resourcePermissions)
    .where(and(
      inArray(resourcePermissions.resourceType, ["session", "runtime"]),
      inArray(resourcePermissions.resourceId, resourceIds),
    ));

  if (sessionId) {
    const sessionPerm = findEffectivePermission(perms, "session", sessionId, user.uuid);
    if (sessionPerm) {
      return WRITABLE_LEVELS.includes(sessionPerm.level as ResourcePermissionLevel);
    }
  }

  const runtimePerm = findEffectivePermission(perms, "runtime", runtimeId, user.uuid);
  if (runtimePerm) {
    return WRITABLE_LEVELS.includes(runtimePerm.level as ResourcePermissionLevel);
  }

  return false;
};
