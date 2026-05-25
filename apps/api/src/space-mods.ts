import { and, eq, inArray } from "drizzle-orm";
import { createDefaultMountSlug, listSpaceMods, assertValidMountSlug, type SpaceModListItem } from "@cohub/core/space-mods";
import { spaceMods, spaces } from "@cohub/db";
import { db } from "./db/index.js";
import type { AuthUser } from "./lib/middleware.js";
import { requireValidId } from "./lib/middleware.js";
import { hasPermission } from "./permissions.js";
import { getSpaceById } from "./space-sessions.js";
import { recoverSpaceSandbox } from "./space-sandboxes.js";

export type CreateSpaceModInput = {
  modSpaceId: string;
  name?: string | null;
  mountSlug?: string | null;
  enabled?: boolean;
};

type SpaceModErrorStatus = 400 | 403 | 404 | 409;

export class SpaceModInputError extends Error {
  constructor(message: string, readonly status: SpaceModErrorStatus = 400) {
    super(message);
    this.name = "SpaceModInputError";
  }
}

type ExistingSpaceMod = Pick<SpaceModListItem, "modSpaceId" | "mountSlug" | "sortOrder">;

export type PreparedSpaceModInsert = typeof spaceMods.$inferInsert;

export function normalizeSpaceModName(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 255) : null;
}

export function parseSpaceModMountSlug(value: string | null | undefined) {
  if (!value) return { ok: true as const, value: null };
  try {
    return { ok: true as const, value: assertValidMountSlug(value) };
  } catch {
    return { ok: false as const, message: "invalid mount slug" };
  }
}

export function getSpaceModUniqueViolationMessage(error: unknown): string | null {
  const record = error as { code?: string; constraint_name?: string; constraint?: string };
  if (record.code !== "23505") return null;
  const constraint = record.constraint_name ?? record.constraint ?? "";
  if (constraint.includes("space_mod")) return "mod space is already mounted";
  if (constraint.includes("mount_slug")) return "mountSlug is already used in this space";
  return "space mod already exists";
}

export function spaceModErrorResponse(error: unknown): { message: string; status: SpaceModErrorStatus } | null {
  if (error instanceof SpaceModInputError) return { message: error.message, status: error.status };
  const message = getSpaceModUniqueViolationMessage(error);
  return message ? { message, status: message.includes("already") ? 409 : 400 } : null;
}

export async function restartSandboxForMods(spaceId: string) {
  const space = await getSpaceById(spaceId);
  if (!space) return;
  void recoverSpaceSandbox({
    spaceId,
    userUuid: space.userUuid,
    ownerUserUuid: space.userUuid,
    reason: "space_mods_changed",
    source: "space_mods",
    verify: true,
  }).catch((error) => {
    console.error(`[SpaceMods] failed to restart sandbox spaceId=${spaceId}`, error);
  });
}

function getValidModSpaceId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && requireValidId(trimmed) ? trimmed : null;
}

export async function prepareSpaceModInserts(input: {
  actor: AuthUser;
  spaceId: string;
  mods: CreateSpaceModInput[];
  existing?: ExistingSpaceMod[];
}): Promise<PreparedSpaceModInsert[]> {
  const existing = input.existing ?? await listSpaceMods(db, input.spaceId);
  const existingModSpaceIds = new Set(existing.map((mod) => mod.modSpaceId));
  const usedSlugs = new Set(existing.map((mod) => mod.mountSlug));
  const seenModSpaceIds = new Set<string>();
  const modSpaceIds: string[] = [];
  const normalized = [] as Array<{
    modSpaceId: string;
    name: string | null;
    mountSlug: string | null;
    enabled: boolean;
  }>;

  for (const mod of input.mods) {
    const modSpaceId = getValidModSpaceId(mod.modSpaceId);
    if (!modSpaceId) throw new SpaceModInputError("modSpaceId is required");
    if (modSpaceId === input.spaceId) throw new SpaceModInputError("space cannot mount itself as a mod");
    if (seenModSpaceIds.has(modSpaceId) || existingModSpaceIds.has(modSpaceId)) {
      throw new SpaceModInputError("mod space is already mounted", 409);
    }

    const slug = parseSpaceModMountSlug(mod.mountSlug);
    if (!slug.ok) throw new SpaceModInputError(slug.message);
    if (slug.value) {
      if (usedSlugs.has(slug.value)) throw new SpaceModInputError("mountSlug is already used in this space", 409);
      usedSlugs.add(slug.value);
    }

    seenModSpaceIds.add(modSpaceId);
    modSpaceIds.push(modSpaceId);
    normalized.push({
      modSpaceId,
      name: normalizeSpaceModName(mod.name),
      mountSlug: slug.value,
      enabled: mod.enabled ?? true,
    });
  }

  if (normalized.length === 0) return [];

  const permitted = await Promise.all(
    modSpaceIds.map((modSpaceId) => hasPermission(input.actor, "file.view", { spaceId: modSpaceId })),
  );
  if (permitted.some((value) => !value)) throw new SpaceModInputError("missing file.view permission for mod space", 403);

  const targets = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(inArray(spaces.id, modSpaceIds));
  if (targets.length !== modSpaceIds.length) throw new SpaceModInputError("mod space not found", 404);

  let nextSortOrder = existing.reduce((max, mod) => Math.max(max, mod.sortOrder), -1) + 1;
  return normalized.map((mod) => {
    const mountSlug = mod.mountSlug ?? createDefaultMountSlug(mod.modSpaceId, usedSlugs);
    usedSlugs.add(mountSlug);
    return {
      spaceId: input.spaceId,
      modSpaceId: mod.modSpaceId,
      name: mod.name,
      mountSlug,
      enabled: mod.enabled,
      sortOrder: nextSortOrder++,
      createdBy: input.actor.uuid,
    };
  });
}

export async function createSpaceMods(input: {
  actor: AuthUser;
  spaceId: string;
  mods: CreateSpaceModInput[];
  restartSandbox?: boolean;
}): Promise<{ items: SpaceModListItem[]; sandboxRestarting: boolean }> {
  const values = await prepareSpaceModInserts(input);
  if (values.length === 0) return { items: await listSpaceMods(db, input.spaceId), sandboxRestarting: false };

  try {
    await db.insert(spaceMods).values(values);
  } catch (error) {
    const response = spaceModErrorResponse(error);
    if (response) throw new SpaceModInputError(response.message, response.status);
    throw error;
  }

  if (input.restartSandbox ?? true) await restartSandboxForMods(input.spaceId);
  return { items: await listSpaceMods(db, input.spaceId), sandboxRestarting: input.restartSandbox ?? true };
}

export async function createSpaceMod(input: {
  actor: AuthUser;
  spaceId: string;
  mod: CreateSpaceModInput;
  restartSandbox?: boolean;
}): Promise<{ item: SpaceModListItem | undefined; sandboxRestarting: boolean }> {
  const result = await createSpaceMods({
    actor: input.actor,
    spaceId: input.spaceId,
    mods: [input.mod],
    restartSandbox: input.restartSandbox,
  });
  return {
    item: result.items.find((mod) => mod.modSpaceId === input.mod.modSpaceId.trim()),
    sandboxRestarting: result.sandboxRestarting,
  };
}

export async function updateSpaceMod(input: {
  spaceId: string;
  modId: string;
  patch: Partial<typeof spaceMods.$inferInsert>;
}) {
  return db
    .update(spaceMods)
    .set(input.patch)
    .where(and(eq(spaceMods.id, input.modId), eq(spaceMods.spaceId, input.spaceId)))
    .returning();
}
