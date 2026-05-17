import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.js";
import * as schema from "@cohub/db";
import { initDrizzleTracing } from "@cohub/infra/tracing/db";

const client = postgres(config.databaseUrl);

export const db = initDrizzleTracing(
  drizzle(client, { schema }),
  {
    dbSystem: "postgresql",
    dbName: "cohub-worker",
  },
);
