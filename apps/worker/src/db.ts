import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.js";
import { checkpoints, spaces, taskRuns, userGitAccounts } from "./db-schema.js";

const client = postgres(config.databaseUrl);

export const db = drizzle(client, { schema: { taskRuns, spaces, checkpoints, userGitAccounts } });
