import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { accessPolicies, spaceMembers, spaceSessions } from "@cohub/db";
import type { AccessPolicyResourceType, SpaceRole } from "@cohub/db";

export type Audience = "member_user" | "signed_in_user" | "anonymous_user";
export const ALL_PERMISSIONS = [
  "space.view",
  "space.edit",
  "space.label.view",
  "space.label.manage",
  "space.label.assign",
  "session.view",
  "session.edit",
  "session.prompt.readonly",
  "session.prompt.fullaccess",
  "file.view",
  "file.view.filtered",
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
  "command.execute",
  "sandbox.view",
  "sandbox.manage",
  "mod.view",
  "mod.manage",
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

export type PermissionSubject = {
  uuid?: string | null;
};

export type AccessPolicy = {
  signedInUserRole: SpaceRole | null;
  anonymousUserRole: SpaceRole | null;
};

export type PermissionAccess = {
  role: SpaceRole | null;
  permissions: Permission[];
};

export type PermissionStore = {
  getSpaceMemberRole(spaceId: string, userId: string): Promise<SpaceRole | null>;
  getAccessPolicy(resourceType: AccessPolicyResourceType, resourceId: string): Promise<AccessPolicy | null>;
  getSessionSpaceId(sessionId: string): Promise<string | null>;
};

export type SpaceSessionLike = {
  id: string;
};

export const ROLE_PERMISSIONS: Record<SpaceRole, ReadonlySet<Permission>> = {
  host: new Set([
    "space.view",
    "space.edit",
    "space.label.view",
    "space.label.manage",
    "space.label.assign",
    "session.view",
    "session.edit",
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
    "command.execute",
    "sandbox.view",
    "sandbox.manage",
    "mod.view",
    "mod.manage",
  ]),
  builder: new Set([
    "space.view",
    "space.label.view",
    "space.label.assign",
    "session.view",
    "session.edit",
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
    "command.execute",
    "sandbox.view",
    "mod.view",
  ]),
  guest: new Set([
    "space.view",
    "space.label.view",
    "session.view",
    "session.prompt.readonly",
    "file.view.filtered",
    "checkpoint.view",
  ]),
};

export const resolveAudience = (user: PermissionSubject | null): Audience => {
  if (user?.uuid) return "signed_in_user";
  return "anonymous_user";
};

export const permissionsForRole = (role: SpaceRole | null): Permission[] => {
  if (!role) return [];
  return ALL_PERMISSIONS.filter((permission) => roleHasPermission(role, permission));
};

export async function resolvePermissionAccess(input: {
  store: PermissionStore;
  user: PermissionSubject | null;
  context: { spaceId: string; sessionId?: string };
}): Promise<PermissionAccess> {
  if (input.user?.uuid) {
    const memberRole = await input.store.getSpaceMemberRole(input.context.spaceId, input.user.uuid);
    if (memberRole) {
      return {
        role: memberRole,
        permissions: permissionsForRole(memberRole),
      };
    }
  }

  const fallbackRole = await resolveNonMemberRole({
    store: input.store,
    user: input.user,
    spaceId: input.context.spaceId,
    sessionId: input.context.sessionId,
  });
  if (!fallbackRole) return { role: null, permissions: [] };
  return {
    role: fallbackRole,
    permissions: permissionsForRole(fallbackRole),
  };
}

export const roleHasPermission = (role: SpaceRole, permission: Permission) => {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  if (permission === "session.prompt.readonly" && permissions.has("session.prompt.fullaccess")) {
    return true;
  }
  if (permission === "file.view.filtered" && permissions.has("file.view")) {
    return true;
  }
  return permissions.has(permission);
};

async function resolveNonMemberRole(input: {
  store: PermissionStore;
  user: PermissionSubject | null;
  spaceId: string;
  sessionId?: string;
}): Promise<SpaceRole | null> {
  const audience = resolveAudience(input.user);
  const sessionPolicy = input.sessionId ? await input.store.getAccessPolicy("session", input.sessionId) : null;
  const effectivePolicy = sessionPolicy ?? await input.store.getAccessPolicy("space", input.spaceId);
  if (!effectivePolicy) return null;
  return audience === "signed_in_user"
    ? (effectivePolicy.signedInUserRole ?? effectivePolicy.anonymousUserRole ?? null)
    : (effectivePolicy.anonymousUserRole ?? null);
}

export async function hasPermission(input: {
  store: PermissionStore;
  user: PermissionSubject | null;
  permission: Permission;
  context: { spaceId: string; sessionId?: string };
}): Promise<boolean> {
  if (input.user?.uuid) {
    const memberRole = await input.store.getSpaceMemberRole(input.context.spaceId, input.user.uuid);
    if (memberRole) return roleHasPermission(memberRole, input.permission);
  }

  const fallbackRole = await resolveNonMemberRole({
    store: input.store,
    user: input.user,
    spaceId: input.context.spaceId,
    sessionId: input.context.sessionId,
  });
  if (!fallbackRole) return false;
  return roleHasPermission(fallbackRole, input.permission);
}

export async function assertPermission(input: {
  store: PermissionStore;
  user: PermissionSubject | null;
  permission: Permission;
  context: { spaceId: string; sessionId?: string };
  message?: string;
}): Promise<void> {
  if (await hasPermission(input)) return;
  throw new Error(input.message ?? `Access denied: missing ${input.permission} permission for space ${input.context.spaceId}.`);
}

export async function filterSessionsByPermission<TSession extends SpaceSessionLike>(input: {
  store: PermissionStore;
  user: PermissionSubject | null;
  permission: Permission;
  spaceId: string;
  sessions: TSession[];
  spacePolicy?: AccessPolicy | null;
}): Promise<TSession[]> {
  if (input.sessions.length === 0) return [];

  if (input.user?.uuid && (await input.store.getSpaceMemberRole(input.spaceId, input.user.uuid)) !== null) {
    throw new Error(
      "filterSessionsByPermission must not be called for space members. " +
      "Use space-level permission checks instead.",
    );
  }

  const audience = resolveAudience(input.user);
  const resolvedSpacePolicy = input.spacePolicy ?? await input.store.getAccessPolicy("space", input.spaceId);
  const sessionPolicyEntries = await Promise.all(
    input.sessions.map(async (session) => [session.id, await input.store.getAccessPolicy("session", session.id)] as const),
  );
  const sessionPolicyMap = new Map(sessionPolicyEntries);

  return input.sessions.filter((session) => {
    const effective = sessionPolicyMap.get(session.id) ?? resolvedSpacePolicy;
    if (!effective) return false;
    const role = audience === "signed_in_user"
      ? (effective.signedInUserRole ?? effective.anonymousUserRole ?? null)
      : (effective.anonymousUserRole ?? null);
    return role !== null && roleHasPermission(role, input.permission);
  });
}

type DrizzlePermissionDb = PostgresJsDatabase<Record<string, unknown>>;

export function createDrizzlePermissionStore(db: DrizzlePermissionDb): PermissionStore {
  return {
    async getSpaceMemberRole(spaceId, userId) {
      const [member] = await db
        .select({ role: spaceMembers.role })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
        .limit(1);
      return member?.role ?? null;
    },
    async getAccessPolicy(resourceType, resourceId) {
      const [policy] = await db
        .select({
          signedInUserRole: accessPolicies.signedInUserRole,
          anonymousUserRole: accessPolicies.anonymousUserRole,
        })
        .from(accessPolicies)
        .where(and(eq(accessPolicies.resourceType, resourceType), eq(accessPolicies.resourceId, resourceId)))
        .limit(1);
      return policy ?? null;
    },
    async getSessionSpaceId(sessionId) {
      const [session] = await db
        .select({ spaceId: spaceSessions.spaceId })
        .from(spaceSessions)
        .where(eq(spaceSessions.id, sessionId))
        .limit(1);
      return session?.spaceId ?? null;
    },
  };
}

export function createBatchDrizzlePermissionStore(db: DrizzlePermissionDb): PermissionStore & {
  filterSessionsByPermission<TSession extends SpaceSessionLike>(input: Omit<Parameters<typeof filterSessionsByPermission<TSession>>[0], "store">): Promise<TSession[]>;
} {
  const store = createDrizzlePermissionStore(db);
  const queryDb = db;

  return {
    ...store,
    async filterSessionsByPermission<TSession extends SpaceSessionLike>(input: Omit<Parameters<typeof filterSessionsByPermission<TSession>>[0], "store">) {
      if (input.sessions.length === 0) return [];
      if (input.user?.uuid && (await store.getSpaceMemberRole(input.spaceId, input.user.uuid)) !== null) {
        throw new Error(
          "filterSessionsByPermission must not be called for space members. " +
          "Use space-level permission checks instead.",
        );
      }

      const audience = resolveAudience(input.user);
      const resolvedSpacePolicy = input.spacePolicy ?? await store.getAccessPolicy("space", input.spaceId);
      const sessionIds = input.sessions.map((session) => session.id);
      const sessionPolicyRows = await queryDb
        .select({
          resourceId: accessPolicies.resourceId,
          signedInUserRole: accessPolicies.signedInUserRole,
          anonymousUserRole: accessPolicies.anonymousUserRole,
        })
        .from(accessPolicies)
        .where(and(eq(accessPolicies.resourceType, "session"), inArray(accessPolicies.resourceId, sessionIds)));
      const sessionPolicyMap = new Map(sessionPolicyRows.map((policy) => [policy.resourceId, policy]));

      return input.sessions.filter((session) => {
        const effective = sessionPolicyMap.get(session.id) ?? resolvedSpacePolicy;
        if (!effective) return false;
        const role = audience === "signed_in_user"
          ? (effective.signedInUserRole ?? effective.anonymousUserRole ?? null)
          : (effective.anonymousUserRole ?? null);
        return role !== null && roleHasPermission(role, input.permission);
      });
    },
  };
}
