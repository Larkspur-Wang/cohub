import { and, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import { resourcePermissions, runtimes } from "./db/schema.js";
import type { AuthUserProfile } from "./auth.js";

/**
 * 判断用户（或匿名）是否对指定资源有读权限。
 * - Owner 始终返回 true
 * - Session 级记录优先于 Runtime 级
 * - 不在表中 = 无权限
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
    const sessionPerm = perms.find(p => p.resourceType === "session" && p.resourceId === sessionId);
    if (sessionPerm) {
      // level="private" 表示明确拒绝，不 fallback
      return sessionPerm.level !== "private";
    }
  }

  // fallback runtime 级
  return perms.some(p => p.resourceType === "runtime" && p.resourceId === runtimeId);
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
