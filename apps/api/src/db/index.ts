import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// connection string can be defined in .env
const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/netaverses";

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });
