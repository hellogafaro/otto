import { defineConfig } from "drizzle-kit";
import { getTableName, is, Table } from "drizzle-orm";
import * as schema from "./apps/server/src/schema";
export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/server/src/schema.ts",
  schemaFilter: ["public"],
  tablesFilter: Object.values(schema)
    .filter((value) => is(value, Table))
    .map(getTableName),
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
