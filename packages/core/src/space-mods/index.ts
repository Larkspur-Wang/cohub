import { asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { spaceMods, spaces } from "@cohub/db";

export type SpaceModRecord = typeof spaceMods.$inferSelect;

export type SpaceModListItem = SpaceModRecord & {
  modSpaceName: string | null;
  modSpaceDescription: string | null;
};

type SpaceModsDb = PostgresJsDatabase<Record<string, unknown>>;

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
  }));
}

export async function listEnabledSpaceMods(db: SpaceModsDb, spaceId: string): Promise<SpaceModListItem[]> {
  return (await listSpaceMods(db, spaceId)).filter((mod) => mod.enabled);
}
