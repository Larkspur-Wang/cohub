/**
 * 清理 dev 环境 runtime 相关数据
 *
 * 使用方法:
 *   pnpm tsx scripts/cleanup-runtime-data.ts [--dry-run] [--confirm]
 *
 * 选项:
 *   --dry-run   只显示将要删除的数据量，不实际删除
 *   --confirm   确认执行删除（必须提供此参数才会真正删除）
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, inArray, eq } from "drizzle-orm";
import Redis from "ioredis";
import * as schema from "../apps/api/src/db/schema.js";
import "dotenv/config";

const {
  runtimes,
  runtimeChannels,
  runtimeSessions,
  runtimeSessionBindings,
  sessionMessages,
  sessionToolCalls,
} = schema;

const isDryRun = process.argv.includes("--dry-run");
const isConfirmed = process.argv.includes("--confirm");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL is not set");
  process.exit(1);
}

const client = postgres(connectionString, { prepare: false });
const db = drizzle(client, { schema });
const redis = new Redis(redisUrl);

async function getDataCounts() {
  const [runtimesCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimes);
  const [channelsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimeChannels);
  const [sessionsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimeSessions);
  const [bindingsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runtimeSessionBindings);
  const [messagesCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionMessages);
  const [toolCallsCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionToolCalls);

  // 获取所有 runtime IDs
  const allRuntimes = await db.select({ id: runtimes.id }).from(runtimes);
  const runtimeIds = allRuntimes.map((r) => r.id);

  // 检查 Redis 中的相关 keys
  let redisKeysCount = 0;
  if (runtimeIds.length > 0) {
    for (const runtimeId of runtimeIds) {
      const keys = await redis.keys(`runtimes:${runtimeId}:*`);
      redisKeysCount += keys.length;
    }
  }

  return {
    runtimes: runtimesCount.count,
    runtimeChannels: channelsCount.count,
    runtimeSessions: sessionsCount.count,
    runtimeSessionBindings: bindingsCount.count,
    sessionMessages: messagesCount.count,
    sessionToolCalls: toolCallsCount.count,
    redisKeys: redisKeysCount,
  };
}

async function cleanupData() {
  console.log("开始清理 runtime 相关数据...\n");

  // 1. 删除 session_tool_calls
  console.log("1. 删除 session_tool_calls...");
  const toolCallsResult = await db.delete(sessionToolCalls);
  console.log(`   已删除 ${toolCallsResult.rowCount ?? 0} 条记录`);

  // 2. 删除 session_messages
  console.log("2. 删除 session_messages...");
  const messagesResult = await db.delete(sessionMessages);
  console.log(`   已删除 ${messagesResult.rowCount ?? 0} 条记录`);

  // 3. 删除 runtime_session_bindings
  console.log("3. 删除 runtime_session_bindings...");
  const bindingsResult = await db.delete(runtimeSessionBindings);
  console.log(`   已删除 ${bindingsResult.rowCount ?? 0} 条记录`);

  // 4. 删除 runtime_sessions
  console.log("4. 删除 runtime_sessions...");
  const sessionsResult = await db.delete(runtimeSessions);
  console.log(`   已删除 ${sessionsResult.rowCount ?? 0} 条记录`);

  // 5. 删除 runtime_channels
  console.log("5. 删除 runtime_channels...");
  const channelsResult = await db.delete(runtimeChannels);
  console.log(`   已删除 ${channelsResult.rowCount ?? 0} 条记录`);

  // 6. 获取所有 runtime IDs 用于清理 Redis
  const allRuntimes = await db.select({ id: runtimes.id }).from(runtimes);
  const runtimeIds = allRuntimes.map((r) => r.id);

  // 7. 删除 runtimes
  console.log("6. 删除 runtimes...");
  const runtimesResult = await db.delete(runtimes);
  console.log(`   已删除 ${runtimesResult.rowCount ?? 0} 条记录`);

  // 8. 清理 Redis keys
  console.log("7. 清理 Redis keys...");
  let redisDeletedCount = 0;
  if (runtimeIds.length > 0) {
    for (const runtimeId of runtimeIds) {
      const keys = await redis.keys(`runtimes:${runtimeId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        redisDeletedCount += keys.length;
      }
    }
  }
  console.log(`   已删除 ${redisDeletedCount} 个 Redis keys`);

  console.log("\n清理完成!");
}

async function main() {
  console.log("=== Dev 环境 Runtime 数据清理工具 ===\n");
  console.log(`模式: ${isDryRun ? "仅查看 (dry-run)" : isConfirmed ? "执行清理" : "仅查看（需 --confirm 确认）"}\n`);

  try {
    // 显示当前数据量
    console.log("正在统计数据量...\n");
    const counts = await getDataCounts();

    console.log("当前 dev 环境数据量:");
    console.log(`  runtimes:                ${counts.runtimes}`);
    console.log(`  runtimeChannels:         ${counts.runtimeChannels}`);
    console.log(`  runtimeSessions:         ${counts.runtimeSessions}`);
    console.log(`  runtimeSessionBindings:  ${counts.runtimeSessionBindings}`);
    console.log(`  sessionMessages:         ${counts.sessionMessages}`);
    console.log(`  sessionToolCalls:        ${counts.sessionToolCalls}`);
    console.log(`  Redis keys:              ${counts.redisKeys}`);
    console.log("");

    if (isDryRun) {
      console.log("dry-run 模式: 仅显示数据量，不执行删除");
    } else if (isConfirmed) {
      console.log("⚠️  即将删除上述所有 runtime 相关数据！");
      console.log("确认执行删除...\n");
      await cleanupData();

      // 验证删除结果
      const afterCounts = await getDataCounts();
      console.log("\n删除后数据量:");
      console.log(`  runtimes:                ${afterCounts.runtimes}`);
      console.log(`  runtimeChannels:         ${afterCounts.runtimeChannels}`);
      console.log(`  runtimeSessions:         ${afterCounts.runtimeSessions}`);
      console.log(`  runtimeSessionBindings:  ${afterCounts.runtimeSessionBindings}`);
      console.log(`  sessionMessages:         ${afterCounts.sessionMessages}`);
      console.log(`  sessionToolCalls:        ${afterCounts.sessionToolCalls}`);
      console.log(`  Redis keys:              ${afterCounts.redisKeys}`);
    } else {
      console.log("提示: 使用 --confirm 参数确认执行删除，或使用 --dry-run 仅查看数据量");
    }
  } catch (error) {
    console.error("执行出错:", error);
    process.exit(1);
  } finally {
    await client.end();
    await redis.quit();
  }
}

main();