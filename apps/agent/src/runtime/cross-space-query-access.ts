import { eq } from "drizzle-orm";
import { assertPermission, createDrizzlePermissionStore } from "@cohub/permissions";
import { spaces } from "@cohub/db-schema";
import { db } from "../db.js";

const permissionStore = createDrizzlePermissionStore(db);

function getBootstrapStatus(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const bootstrap = (meta as Record<string, unknown>).bootstrap;
  if (!bootstrap || typeof bootstrap !== "object" || Array.isArray(bootstrap)) return null;
  const status = (bootstrap as Record<string, unknown>).status;
  return typeof status === "string" ? status : null;
}

export async function assertSpaceFileViewAccess(input: {
  actorUserId: string;
  spaceId: string;
}): Promise<void> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, input.spaceId)).limit(1);
  if (!space) throw new Error(`Space not found: ${input.spaceId}`);

  await assertPermission({
    store: permissionStore,
    user: { uuid: input.actorUserId },
    permission: "file.view",
    context: { spaceId: input.spaceId },
  });

  const bootstrapStatus = getBootstrapStatus(space.meta);
  if (bootstrapStatus === "failed") throw new Error(`Workspace setup failed for space ${input.spaceId}.`);
  if (bootstrapStatus !== null && bootstrapStatus !== "ready") throw new Error(`Workspace is not ready for space ${input.spaceId} yet.`);
}
