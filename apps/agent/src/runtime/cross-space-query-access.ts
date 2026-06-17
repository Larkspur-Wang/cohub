import { eq } from "drizzle-orm";
import { createDrizzlePermissionStore, hasPermission } from "@cohub/core/permissions";
import { spaces } from "@cohub/db";
import { db } from "../db.js";
import type { AgentFileVisibility } from "./workspace-visibility.js";

const permissionStore = createDrizzlePermissionStore(db);

type WorkSessionPromptAuthContext = {
  type?: unknown;
  spaceId?: unknown;
  scopes?: unknown;
  exp?: unknown;
};

function visibilityFromPromptAuth(auth: unknown, spaceId: string): AgentFileVisibility | null {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
  const context = auth as WorkSessionPromptAuthContext;
  if (context.type !== "work_session" || context.spaceId !== spaceId || !Array.isArray(context.scopes)) return null;
  if (typeof context.exp === "number" && context.exp <= Math.floor(Date.now() / 1000)) return null;
  if (context.scopes.includes("file.view")) return "full";
  if (context.scopes.includes("file.view.filtered")) return "filtered";
  return null;
}

export async function resolveSpaceFileVisibility(input: {
  actorUserId: string;
  spaceId: string;
  promptAuth?: unknown;
}): Promise<AgentFileVisibility> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, input.spaceId)).limit(1);
  if (!space) throw new Error("Space not found.");

  const promptAuthVisibility = visibilityFromPromptAuth(input.promptAuth, input.spaceId);
  if (promptAuthVisibility) return promptAuthVisibility;

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
  promptAuth?: unknown;
}): Promise<void> {
  await resolveSpaceFileVisibility(input);
}
