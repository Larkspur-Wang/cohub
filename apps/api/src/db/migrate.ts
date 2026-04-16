import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(connectionString, {
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 30,
});
const db = drizzle(client);

async function runMigrate() {
  console.log("[Migration] Running V2 database migrations...");

  try {
    await client`SELECT 1`;
    console.log("[Migration] Database connection verified.");

    await client`CREATE SCHEMA IF NOT EXISTS v2`;
    console.log("[Migration] Ensured schema v2 exists.");

    await migrate(db, { migrationsFolder: "./drizzle/v2" });
    console.log("[Migration] V2 migrations completed successfully.");
  } catch (error) {
    console.error("[Migration] V2 migration failed:", error);
    throw error;
  } finally {
    await client.end({ timeout: 5 });
  }
}

runMigrate();
