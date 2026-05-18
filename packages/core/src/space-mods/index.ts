import { asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { spaceMods, spaces } from "@cohub/db";

export const SANDBOX_MODS_PATH = "/mods";

export type SpaceModRecord = typeof spaceMods.$inferSelect;

export type SpaceModListItem = SpaceModRecord & {
  modSpaceName: string | null;
  modSpaceDescription: string | null;
  mountPath: string;
};

type SpaceModsDb = PostgresJsDatabase<Record<string, unknown>>;

export function normalizeMountSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

export function assertValidMountSlug(value: string): string {
  const slug = normalizeMountSlug(value);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw new Error("mountSlug must be 1-63 chars of lowercase letters, numbers, or hyphens");
  }
  return slug;
}

export function getSpaceModMountPath(mountSlug: string) {
  return `${SANDBOX_MODS_PATH}/${assertValidMountSlug(mountSlug)}`;
}

export function createDefaultMountSlug(modSpaceId: string, existingSlugs: Iterable<string> = []) {
  const compact = modSpaceId.replaceAll("-", "").toLowerCase();
  const taken = new Set(Array.from(existingSlugs, (item) => item.toLowerCase()));
  for (const length of [8, 12, 16, 20, 32]) {
    const candidate = assertValidMountSlug(compact.slice(0, length));
    if (!taken.has(candidate)) return candidate;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = assertValidMountSlug(`${compact.slice(0, 8)}-${index}`);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("failed to generate unique mod mount slug");
}

export function getSpaceModMountSignature(mods: Pick<SpaceModRecord, "modSpaceId" | "mountSlug" | "enabled" | "sortOrder">[]) {
  return JSON.stringify(
    mods
      .filter((mod) => mod.enabled)
      .map((mod) => ({ modSpaceId: mod.modSpaceId, mountSlug: mod.mountSlug, sortOrder: mod.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.mountSlug.localeCompare(b.mountSlug)),
  );
}

export async function listSpaceMods(db: SpaceModsDb, spaceId: string): Promise<SpaceModListItem[]> {
  const rows = await db
    .select({
      mod: spaceMods,
      modSpaceName: spaces.name,
      modSpaceDescription: spaces.description,
    })
    .from(spaceMods)
    .leftJoin(spaces, eq(spaceMods.modSpaceId, spaces.id))
    .where(eq(spaceMods.spaceId, spaceId))
    .orderBy(asc(spaceMods.sortOrder), asc(spaceMods.createdAt));

  return rows.map((row) => ({
    ...row.mod,
    modSpaceName: row.modSpaceName,
    modSpaceDescription: row.modSpaceDescription,
    mountPath: getSpaceModMountPath(row.mod.mountSlug),
  }));
}

export async function listEnabledSpaceMods(db: SpaceModsDb, spaceId: string): Promise<SpaceModListItem[]> {
  return (await listSpaceMods(db, spaceId)).filter((mod) => mod.enabled);
}
