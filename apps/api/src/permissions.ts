import { and, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import { resourcePermissions, spaces } from "./db/schema-v2.js";
import type { AuthUserProfile } from "./auth.js";
import type { ResourcePermissionLevel } from "@cohub/protocol";

const READABLE_LEVELS: ResourcePermissionLevel[] = ["read", "write"];
const WRITABLE_LEVELS: ResourcePermissionLevel[] = ["write"];

const findEffectivePermission = (
  perms: typeof resourcePermissions.$inferSelect[],
  resourceType: "space" | "session",
  resourceId: string,
  userUuid: string | null,
): typeof resourcePermissions.$inferSelect | null => {
  if (userUuid) {
    const userPerm = perms.find(
      (permission) =>
        permission.resourceType === resourceType &&
        permission.resourceId === resourceId &&
        permission.granteeUuid === userUuid,
    );
    if (userPerm) return userPerm;
  }

  const publicPerm = perms.find(
    (permission) =>
      permission.resourceType === resourceType &&
      permission.resourceId === resourceId &&
      permission.granteeUuid === null,
  );
  return publicPerm ?? null;
};

export const canRead = async (
  user: AuthUserProfile | null,
  spaceId: string,
  sessionId?: string,
): Promise<boolean> => {
  if (user?.uuid) {
    const [space] = await db
      .select({ userUuid: spaces.userUuid })
      .from(spaces)
      .where(inArray(spaces.id, [spaceId]))
      .limit(1);
    if (space?.userUuid === user.uuid) return true;
  }

  const resourceIds = [spaceId, ...(sessionId ? [sessionId] : [])];
  const permissions = await db
    .select()
    .from(resourcePermissions)
    .where(
      and(
        inArray(resourcePermissions.resourceType, ["session", "space"]),
        inArray(resourcePermissions.resourceId, resourceIds),
      ),
    );

  if (sessionId) {
    const sessionPermission = findEffectivePermission(
      permissions,
      "session",
      sessionId,
      user?.uuid ?? null,
    );
    if (sessionPermission) {
      return READABLE_LEVELS.includes(sessionPermission.level as ResourcePermissionLevel);
    }
  }

  const spacePermission = findEffectivePermission(
    permissions,
    "space",
    spaceId,
    user?.uuid ?? null,
  );
  if (spacePermission) {
    return READABLE_LEVELS.includes(spacePermission.level as ResourcePermissionLevel);
  }

  return false;
};

export const canReadForSession = async (
  user: AuthUserProfile | null,
  spaceId: string,
  sessionId: string,
): Promise<boolean> => {
  return canRead(user, spaceId, sessionId);
};

export const canWrite = async (
  user: AuthUserProfile | null,
  spaceId: string,
  sessionId?: string,
): Promise<boolean> => {
  if (!user?.uuid) return false;

  const [space] = await db
    .select({ userUuid: spaces.userUuid })
    .from(spaces)
    .where(inArray(spaces.id, [spaceId]))
    .limit(1);
  if (space?.userUuid === user.uuid) return true;

  const resourceIds = [spaceId, ...(sessionId ? [sessionId] : [])];
  const permissions = await db
    .select()
    .from(resourcePermissions)
    .where(
      and(
        inArray(resourcePermissions.resourceType, ["session", "space"]),
        inArray(resourcePermissions.resourceId, resourceIds),
      ),
    );

  if (sessionId) {
    const sessionPermission = findEffectivePermission(
      permissions,
      "session",
      sessionId,
      user.uuid,
    );
    if (sessionPermission) {
      return WRITABLE_LEVELS.includes(sessionPermission.level as ResourcePermissionLevel);
    }
  }

  const spacePermission = findEffectivePermission(permissions, "space", spaceId, user.uuid);
  if (spacePermission) {
    return WRITABLE_LEVELS.includes(spacePermission.level as ResourcePermissionLevel);
  }

  return false;
};
