import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "./env.js";

export const dbClient = postgres(env.DATABASE_URL, { prepare: false });
export const db = drizzle(dbClient);

export async function closeDb() {
  await dbClient.end({ timeout: 5 }).catch(() => undefined);
}
