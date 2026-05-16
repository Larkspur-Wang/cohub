import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "../../packages/db-schema/src/schema-v2.ts",
  out: "./drizzle/v2",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgres://postgres:postgres@localhost:5432/cohub",
  },
});
