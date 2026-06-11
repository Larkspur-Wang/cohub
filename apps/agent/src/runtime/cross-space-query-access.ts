import { eq } from "drizzle-orm";
import { createDrizzlePermissionStore, hasPermission } from "@cohub/core/permissions";
import { spaces } from "@cohub/db";
import { db } from "../db.js";
import type { AgentFileVisibility } from "./workspace-visibility.js";

const permissionStore = createDrizzlePermissionStore(db);

function getBootstrapStatus(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const bootstrap = (meta as Record<string, unknown>).bootstrap;
  if (!bootstrap || typeof bootstrap !== "object" || Array.isArray(bootstrap)) return null;
  const status = (bootstrap as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}

export async function resolveSpaceFileVisibility(input: {
  actorUserId: string;
  spaceId: string;
}): Promise<AgentFileVisibility> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, input.spaceId)).limit(1);
  if (!space) throw new Error("Access denied.");

  const user = { uuid: input.actorUserId };
  const context = { spaceId: input.spaceId };
  const visibility = await hasPermission({ store: permissionStore, user, permission: "file.view", context })
    ? "full"
    : await hasPermission({ store: permissionStore, user, permission: "file.view.filtered", context })
      ? "filtered"
      : null;
  if (!visibility) throw new Error("Access denied.");

  const bootstrapStatus = getBootstrapStatus(space.meta);
  if (bootstrapStatus === "failed") throw new Error("Access denied.");
  if (bootstrapStatus !== null && bootstrapStatus !== "ready") throw new Error("Access denied.");
  return visibility;
}

export async function assertSpaceFileViewAccess(input: {
  actorUserId: string;
  spaceId: string;
}): Promise<void> {
  await resolveSpaceFileVisibility(input);
}
