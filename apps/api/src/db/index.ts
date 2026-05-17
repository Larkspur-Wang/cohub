import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@cohub/db";
import { initDrizzleTracing } from "@cohub/infra/tracing/db";

// connection string can be defined in .env
const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/cohub";

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString, { prepare: false });
export const db = initDrizzleTracing(
  drizzle(client, { schema }),
  {
    dbSystem: "postgresql",
    dbName: "cohub",
  },
);
