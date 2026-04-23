import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { accessPolicies, spaceMembers, spaceSessions } from "./db/schema-v2.js";
import type { AuthUserProfile } from "./auth.js";
import type { AccessPolicyResourceType, SpaceRole } from "./db/schema-v2.js";

export type Audience = "member_user" | "signed_in_user" | "anonymous_user";
export type Permission =
  | "space.view"
  | "space.edit"
  | "session.view"
  | "session.prompt.readonly"
  | "session.prompt.fullaccess"
  | "file.view"
  | "file.edit"
  | "checkpoint.view"
  | "checkpoint.edit"
  | "member.view"
  | "member.manage"
  | "channel.view"
  | "channel.manage"
  | "cronjob.view"
  | "cronjob.manage"
  | "taskrun.view"
  | "sandbox.view"
  | "sandbox.manage";

const ROLE_PERMISSIONS: Record<SpaceRole, Set<Permission>> = {
  host: new Set([
    "space.view",
    "space.edit",
    "session.view",
    "session.prompt.readonly",
    "session.prompt.fullaccess",
    "file.view",
    "file.edit",
    "checkpoint.view",
    "checkpoint.edit",
    "member.view",
    "member.manage",
    "channel.view",
    "channel.manage",
    "cronjob.view",
    "cronjob.manage",
    "taskrun.view",
    "sandbox.view",
    "sandbox.manage",
  ]),
  maker: new Set([
    "space.view",
    "session.view",
    "session.prompt.readonly",
    "session.prompt.fullaccess",
    "file.view",
    "file.edit",
    "checkpoint.view",
    "checkpoint.edit",
    "member.view",
    "channel.view",
    "cronjob.view",
    "taskrun.view",
    "sandbox.view",
  ]),
  guest: new Set([
    "space.view",
    "session.view",
    "session.prompt.readonly",
    "file.view",
    "checkpoint.view",
  ]),
};

const resolveAudience = (user: AuthUserProfile | null): Audience => {
  if (user?.uuid) return "signed_in_user";
  return "anonymous_user";
};

const roleHasPermission = (role: SpaceRole, permission: Permission) => {
  if (permission === "session.prompt.readonly" && ROLE_PERMISSIONS[role].has("session.prompt.fullaccess")) {
    return true;
  }
  return ROLE_PERMISSIONS[role].has(permission);
};

async function getSpaceMemberRole(spaceId: string, userId: string): Promise<SpaceRole | null> {
  const [member] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
    .limit(1);
  return member?.role ?? null;
}

async function getAccessPolicy(resourceType: AccessPolicyResourceType, resourceId: string) {
  const [policy] = await db
    .select({
      signedInUserRole: accessPolicies.signedInUserRole,
      anonymousUserRole: accessPolicies.anonymousUserRole,
    })
    .from(accessPolicies)
    .where(and(eq(accessPolicies.resourceType, resourceType), eq(accessPolicies.resourceId, resourceId)))
    .limit(1);
  return policy ?? null;
}

async function resolveNonMemberRole(input: {
  user: AuthUserProfile | null;
  spaceId: string;
  sessionId?: string;
}): Promise<SpaceRole | null> {
  const audience = resolveAudience(input.user);
  const sessionPolicy = input.sessionId ? await getAccessPolicy("session", input.sessionId) : null;
  const effectivePolicy = sessionPolicy ?? await getAccessPolicy("space", input.spaceId);
  if (!effectivePolicy) return null;
  return audience === "signed_in_user"
    ? (effectivePolicy.signedInUserRole ?? null)
    : (effectivePolicy.anonymousUserRole ?? null);
}

export async function hasPermission(
  user: AuthUserProfile | null,
  permission: Permission,
  context: { spaceId: string; sessionId?: string },
): Promise<boolean> {
  if (user?.uuid) {
    const memberRole = await getSpaceMemberRole(context.spaceId, user.uuid);
    if (memberRole) return roleHasPermission(memberRole, permission);
  }

  const fallbackRole = await resolveNonMemberRole({
    user,
    spaceId: context.spaceId,
    sessionId: context.sessionId,
  });
  if (!fallbackRole) return false;
  return roleHasPermission(fallbackRole, permission);
}

export async function getRoleForSpaceUser(spaceId: string, userId: string): Promise<SpaceRole | null> {
  return getSpaceMemberRole(spaceId, userId);
}

export async function getSessionSpaceId(sessionId: string): Promise<string | null> {
  const [session] = await db
    .select({ spaceId: spaceSessions.spaceId })
    .from(spaceSessions)
    .where(eq(spaceSessions.id, sessionId))
    .limit(1);
  return session?.spaceId ?? null;
}
