import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.js";
import { checkpoints, spaces, taskRuns, userGitAccounts } from "@cohub/db-schema";
import { initDrizzleTracing } from "@cohub/tracing/db";

const client = postgres(config.databaseUrl);

export const db = initDrizzleTracing(
  drizzle(client, { schema: { taskRuns, spaces, checkpoints, userGitAccounts } }),
  {
    dbSystem: "postgresql",
    dbName: "cohub-worker",
  },
);
