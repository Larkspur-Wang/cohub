import { inArray } from "drizzle-orm";
import { listSpaceMods, type SpaceModListItem } from "@cohub/core/space-mods";
import { spaceMods, spaces } from "@cohub/db";
import { db } from "./db/index.js";
import type { AuthUser } from "./lib/middleware.js";
import { requireValidId } from "./lib/middleware.js";
import { hasPermission } from "./permissions.js";

export type CreateSpaceModInput = {
  modSpaceId: string;
  enabled?: boolean;
};

type SpaceModErrorStatus = 400 | 403 | 404 | 409;

export class SpaceModInputError extends Error {
  constructor(message: string, readonly status: SpaceModErrorStatus = 400) {
    super(message);
    this.name = "SpaceModInputError";
  }
}

type ExistingSpaceMod = Pick<SpaceModListItem, "modSpaceId" | "sortOrder">;

export type PreparedSpaceModInsert = typeof spaceMods.$inferInsert;

export function getSpaceModUniqueViolationMessage(error: unknown): string | null {
  const record = error as { code?: string; constraint_name?: string; constraint?: string };
  if (record.code !== "23505") return null;
  return "mod space is already added";
}

export function spaceModErrorResponse(error: unknown): { message: string; status: SpaceModErrorStatus } | null {
  if (error instanceof SpaceModInputError) return { message: error.message, status: error.status };
  const message = getSpaceModUniqueViolationMessage(error);
  return message ? { message, status: 409 } : null;
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
  const seenModSpaceIds = new Set<string>();
  const modSpaceIds: string[] = [];
  const normalized = [] as Array<{
    modSpaceId: string;
    enabled: boolean;
  }>;

  for (const mod of input.mods) {
    const modSpaceId = getValidModSpaceId(mod.modSpaceId);
    if (!modSpaceId) throw new SpaceModInputError("modSpaceId is required");
    if (modSpaceId === input.spaceId) throw new SpaceModInputError("space cannot mount itself as a mod");
    if (seenModSpaceIds.has(modSpaceId) || existingModSpaceIds.has(modSpaceId)) {
      throw new SpaceModInputError("mod space is already added", 409);
    }

    seenModSpaceIds.add(modSpaceId);
    modSpaceIds.push(modSpaceId);
    normalized.push({
      modSpaceId,
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
  return normalized.map((mod) => ({
    spaceId: input.spaceId,
    modSpaceId: mod.modSpaceId,
    enabled: mod.enabled,
    sortOrder: nextSortOrder++,
    createdBy: input.actor.uuid,
  }));
}

export async function createSpaceMods(input: {
  actor: AuthUser;
  spaceId: string;
  mods: CreateSpaceModInput[];
}): Promise<{ items: SpaceModListItem[] }> {
  const values = await prepareSpaceModInserts(input);
  if (values.length > 0) {
    try {
      await db.insert(spaceMods).values(values);
    } catch (error) {
      const response = spaceModErrorResponse(error);
      if (response) throw new SpaceModInputError(response.message, response.status);
      throw error;
    }
  }

  return { items: await listSpaceMods(db, input.spaceId) };
}

export async function createSpaceMod(input: {
  actor: AuthUser;
  spaceId: string;
  mod: CreateSpaceModInput;
}): Promise<{ item: SpaceModListItem | undefined }> {
  const result = await createSpaceMods({
    actor: input.actor,
    spaceId: input.spaceId,
    mods: [input.mod],
  });

  return {
    item: result.items.find((mod) => mod.modSpaceId === input.mod.modSpaceId.trim()),
  };
}
