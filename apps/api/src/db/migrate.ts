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

    // 确保 drizzle schema 和 migration tracking 表存在
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `;

    // 检查是否已经跑过 V2 migration
    const migrationRows = await client`SELECT COUNT(*) FROM drizzle.__drizzle_migrations` as postgres.Row[];
    const migrationCount = Number(migrationRows[0]?.count);
    if (migrationCount > 0) {
      console.log("[Migration] V2 migrations already applied, skipping.");
      return;
    }

    // v2 schema 可能残留（之前迁移失败），先清理，避免 drizzle SQL 中裸 CREATE SCHEMA 报错
    const schemaRows = await client`
      SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'v2')
    ` as postgres.Row[];
    const schemaExists = schemaRows[0]?.exists as boolean;
    if (schemaExists) {
      console.log("[Migration] v2 schema exists but not recorded, cleaning up...");
      await client`DROP SCHEMA v2 CASCADE`;
    }

    // 执行 migration（SQL 文件中包含 CREATE SCHEMA "v2"，此时 schema 不存在，会成功）
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
