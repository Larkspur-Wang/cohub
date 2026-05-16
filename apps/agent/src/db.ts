import * as schema from "@cohub/db-schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env.js";

export const dbClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(dbClient, { schema });

export async function closeDb() {
  await dbClient.end({ timeout: 5 }).catch(() => undefined);
}
