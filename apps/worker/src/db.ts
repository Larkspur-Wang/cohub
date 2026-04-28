import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.js";
import { checkpoints, spaces, taskRuns, userGitAccounts } from "./db-schema.js";
import { initDrizzleTracing, instrumentPostgresClient } from "@cohub/tracing/db";

const client = instrumentPostgresClient(postgres(config.databaseUrl), {
  tracerName: "cohub-worker",
});

export const db = initDrizzleTracing(
  drizzle(client, { schema: { taskRuns, spaces, checkpoints, userGitAccounts } }),
  {
    dbSystem: "postgresql",
    dbName: "cohub-worker",
  },
);
