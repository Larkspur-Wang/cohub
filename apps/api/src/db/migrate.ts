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
  console.log("[Migration] Running database migrations...");

  try {
    // Verify connectivity first
    await client`SELECT 1`;
    console.log("[Migration] Database connection verified.");

    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[Migration] Migrations completed successfully.");
  } catch (error) {
    console.error("[Migration] Migration failed:", error);
    throw error;
  } finally {
    await client.end({ timeout: 5 });
  }
}

runMigrate();
