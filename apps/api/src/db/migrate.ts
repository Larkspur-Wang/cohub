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

    // 检查 v2 schema 状态
    const schemaRows = await client`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'v2'
      )
    ` as postgres.Row[];
    const hasTables = schemaRows[0]?.exists as boolean;

    // 检查 v2 schema 本身是否存在
    const schemaExistsRows = await client`
      SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'v2')
    ` as postgres.Row[];
    const schemaExists = schemaExistsRows[0]?.exists as boolean;

    if (schemaExists && !hasTables) {
      // 残留的空 schema（之前迁移失败），清理掉让 drizzle 重建
      console.log("[Migration] v2 schema exists but has no tables (stale), cleaning up...");
      await client`DROP SCHEMA v2 CASCADE`;
    } else if (schemaExists && hasTables) {
      console.log("[Migration] v2 schema exists with tables, assuming migration already done.");
    }

    // 执行 migration
    // drizzle 会自动比对 __drizzle_migrations 中的 hash，只执行未跑过的 SQL
    // SQL 文件中的 CREATE SCHEMA "v2" 在 schema 不存在时会成功
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
