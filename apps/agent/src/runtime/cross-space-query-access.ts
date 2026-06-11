import { eq } from "drizzle-orm";
import { createDrizzlePermissionStore, hasPermission } from "@cohub/core/permissions";
import { spaces } from "@cohub/db";
import { db } from "../db.js";
import type { AgentFileVisibility } from "./workspace-visibility.js";

const permissionStore = createDrizzlePermissionStore(db);

export async function resolveSpaceFileVisibility(input: {
  actorUserId: string;
  spaceId: string;
}): Promise<AgentFileVisibility> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, input.spaceId)).limit(1);
  if (!space) throw new Error("Space not found.");

  const user = { uuid: input.actorUserId };
  const context = { spaceId: input.spaceId };
  const visibility = await hasPermission({ store: permissionStore, user, permission: "file.view", context })
    ? "full"
    : await hasPermission({ store: permissionStore, user, permission: "file.view.filtered", context })
      ? "filtered"
      : null;
  if (!visibility) throw new Error("File access denied.");
  return visibility;
}

export async function assertSpaceFileViewAccess(input: {
  actorUserId: string;
  spaceId: string;
}): Promise<void> {
  await resolveSpaceFileVisibility(input);
}
