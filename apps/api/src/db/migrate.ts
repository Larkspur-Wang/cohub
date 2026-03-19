import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

async function runMigrate() {
  console.log("[Migration] Running database migrations...");

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[Migration] Migrations completed successfully.");
  } catch (error) {
    console.error("[Migration] Migration failed:", error);
    throw error;
  } finally {
    await client.end();
  }
}

runMigrate();