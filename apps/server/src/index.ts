import { createS3Storage } from "@otto/artifacts/storage";
import { openDatabase } from "@otto/db";
import { z } from "zod";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { startJobs } from "./jobs";
import { createRealtime, type RealtimeData } from "./realtime";

const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    OTTO_ORIGIN: z.url(),
    PORT: z.coerce.number().int().min(1024).max(65535).default(43001),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default("garage"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .parse(process.env);
const { db, pool } = openDatabase({ connectionString: config.DATABASE_URL });
const boss = await startJobs(db, pool);
const storage =
  config.S3_ENDPOINT &&
  config.S3_BUCKET &&
  config.S3_ACCESS_KEY_ID &&
  config.S3_SECRET_ACCESS_KEY
    ? createS3Storage({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        bucket: config.S3_BUCKET,
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      })
    : undefined;
const options = {
  db,
  boss,
  auth: createAuth(db, config.BETTER_AUTH_SECRET, config.OTTO_ORIGIN),
  origin: config.OTTO_ORIGIN,
  storage,
};
const app = createApp(options);
const realtime = createRealtime(options);
const server = Bun.serve<RealtimeData>({
  hostname: "127.0.0.1",
  port: config.PORT,
  maxRequestBodySize: 1024 * 1024,
  idleTimeout: 30,
  websocket: realtime.websocket,
  async fetch(request, server) {
    if (new URL(request.url).pathname === "/api/realtime") {
      const data = await realtime.prepare(request);
      if (data instanceof Response) return data;
      if (server.upgrade(request, { data })) return;
      return new Response(null, { status: 400 });
    }
    return app.fetch(request, server);
  },
});
async function stop() {
  realtime.close();
  await server.stop();
  await boss.stop();
  await pool.end();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
