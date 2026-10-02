import { openDatabase } from "@otto/db";
import { z } from "zod";
import { createApp } from "./app";
import { createAuth } from "./auth";

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    OTTO_ORIGIN: z.url(),
    PORT: z.coerce.number().int().min(1024).max(65535).default(43001),
  })
  .parse(process.env);
const { db, pool } = openDatabase({ connectionString: config.DATABASE_URL });
await pool.query("select 1");
const app = createApp(
  createAuth(db, config.BETTER_AUTH_SECRET, config.OTTO_ORIGIN),
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.PORT,
  fetch: app.fetch,
  maxRequestBodySize: 1024 * 1024,
  idleTimeout: 30,
});
async function stop() {
  await server.stop();
  await pool.end();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
