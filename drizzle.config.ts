import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: ["./packages/*/src/schema.ts"],
  out: "./drizzle",
});
