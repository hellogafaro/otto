import { fileURLToPath } from "node:url";
import { createCursorCodec, openDatabase } from "@otto/db";
import { MAX_FILE_BYTES } from "@otto/files";
import { createS3Storage } from "@otto/files/storage";
import { createRunRuntime, type RunRuntime } from "@otto/runs/runtime";
import { validateSchedule } from "@otto/schedules";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createApp } from "./app";
import { createAuth } from "./auth";
import type { ServerConfig } from "./config";
import type { ConnectionOptions } from "./connections";
import { createLogger } from "./logger";
import { createResendMail } from "./mail";
import { createModelGateway, type ModelGateway } from "./model-gateway";
import { startQueue } from "./queue";
import { createRealtime, type RealtimeData } from "./realtime";
import * as schema from "./schema";
import { readRunSkillFile } from "./skill-files";
import { createSpool, type Spool } from "./spool";
import {
  createSubscriptionLogin,
  type SubscriptionLogin,
} from "./subscription-login";
import {
  createInfisicalAccounts,
  type InfisicalAccounts,
} from "./subscription-secrets";
import { createRunTools, runToolSchema } from "./tools";
import { createOpenRouterTranscriber } from "./transcription";

/** Acquires resources in dependency order and releases every acquired resource on failure. */
export async function startServer(
  config: ServerConfig,
  services: {
    execution?: Pick<
      Parameters<typeof createRunRuntime>[1],
      "backend" | "pi" | "deadlineMs"
    >;
    connections?: ConnectionOptions;
    accounts?: InfisicalAccounts;
    gateway?: Pick<
      Parameters<typeof createModelGateway>[1],
      "endpoint" | "key" | "allowLoopbackHttp" | "modelConfig"
    > & { storeKey: string };
  } = {},
) {
  const { execution, connections } = services;
  const logger = createLogger();
  const { db, pool } = openDatabase({ connectionString: config.DATABASE_URL });
  pool.on("error", () => logger.error("database connection failure"));
  let boss: Awaited<ReturnType<typeof startQueue>> | undefined;
  let server: Bun.Server<RealtimeData> | undefined;
  let realtime: ReturnType<typeof createRealtime> | undefined;
  let storage: ReturnType<typeof createS3Storage> | undefined;
  let spool: Spool | undefined;
  let runtime: RunRuntime | undefined;
  let subscriptionLogin: SubscriptionLogin | undefined;
  let modelGateway: ModelGateway | undefined;
  let closing = false;
  let stopPromise: Promise<void> | undefined;
  let queueStopped = false;
  async function cleanup() {
    closing = true;
    const errors: unknown[] = [];
    try {
      realtime?.close();
    } catch (error) {
      errors.push(error);
    }
    // Stop accepting traffic, then drain bounded requests before jobs and database.
    const drain = server?.stop();
    let forced: Promise<void> | undefined;
    const force = setTimeout(() => {
      forced = Promise.resolve(server?.stop(true)).catch((error: unknown) => {
        errors.push(error);
      });
    }, 10000);
    try {
      await drain;
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(force);
      await forced;
    }
    try {
      await boss?.stop({ timeout: 10000 });
    } catch (error) {
      errors.push(error);
    }
    try {
      await runtime?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await modelGateway?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await subscriptionLogin?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      storage?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await spool?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await pool.end();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "Resource cleanup failed");
  }
  function stop() {
    stopPromise ??= cleanup();
    return stopPromise;
  }
  try {
    // Check declared columns/types read-only; startup never runs development DDL.
    const tables = Object.values(schema).map(getTableConfig);
    const installed = await pool.query<{
      table: string;
      column: string;
      type: string;
      required: boolean;
    }>(
      `select c.relname as table,a.attname as column,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as required
       from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1) and a.attnum>0 and not a.attisdropped`,
      [tables.map((table) => table.name)],
    );
    const columns = new Map(
      installed.rows.map((column) => [
        `${column.table}.${column.column}`,
        column,
      ]),
    );
    for (const table of tables)
      for (const column of table.columns) {
        const actual = columns.get(`${table.name}.${column.name}`);
        if (
          !actual ||
          actual.type !== column.getSQLType() ||
          actual.required !== column.notNull
        )
          throw new Error(
            "Database schema differs from declared columns; run development schema push",
          );
      }
    if (
      config.S3_ENDPOINT &&
      config.S3_BUCKET &&
      config.S3_ACCESS_KEY_ID &&
      config.S3_SECRET_ACCESS_KEY
    ) {
      storage = createS3Storage({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        bucket: config.S3_BUCKET,
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      });
      await storage.check();
      spool = await createSpool({
        baseDir: config.UPLOAD_SPOOL_DIR,
        budgetBytes: config.UPLOAD_SPOOL_BYTES,
      });
    }
    const accounts =
      services.accounts ??
      (config.INFISICAL_URL &&
      config.INFISICAL_TOKEN &&
      config.OTTO_ACCOUNT_SECRET_BINDINGS
        ? createInfisicalAccounts({
            endpoint: config.INFISICAL_URL,
            bindings: config.OTTO_ACCOUNT_SECRET_BINDINGS,
            getAccessToken: async () => {
              if (!config.INFISICAL_TOKEN)
                throw new Error("Account secret authentication unavailable");
              return config.INFISICAL_TOKEN;
            },
          })
        : undefined);
    const gateway =
      services.gateway ??
      (config.OTTO_GATEWAY_URL &&
      config.OTTO_GATEWAY_KEY &&
      config.OTTO_GATEWAY_STORE_KEY
        ? {
            endpoint: config.OTTO_GATEWAY_URL,
            // The packaged gateway shares this server's network namespace. HTTP is accepted only on loopback.
            allowLoopbackHttp: true,
            key: config.OTTO_GATEWAY_KEY,
            storeKey: config.OTTO_GATEWAY_STORE_KEY,
          }
        : undefined);
    if (accounts)
      subscriptionLogin = createSubscriptionLogin(db, accounts, pool);
    if (gateway && subscriptionLogin)
      modelGateway = createModelGateway(db, {
        ...gateway,
        origin: config.OTTO_ORIGIN,
        accounts: subscriptionLogin,
      });
    const pi = execution
      ? {
          ...execution.pi,
          authorizeModel:
            modelGateway?.authorizeModel ?? execution.pi.authorizeModel,
        }
      : undefined;
    if (execution)
      runtime = createRunRuntime(db, {
        ...execution,
        pi: pi ?? execution.pi,
        extensionSource: await Bun.file(
          Bun.resolveSync(
            "@otto/runs/pi-extension",
            fileURLToPath(new URL(".", import.meta.url)),
          ),
        ).text(),
        toolSchema: runToolSchema,
        modelAccess: modelGateway?.issue,
        validateSchedule,
        readSkillFile: async (input) => {
          if (!storage) throw new Error("Skill storage unavailable");
          return readRunSkillFile(db, storage, input);
        },
        handleTool: async (attempt, input, signal) => {
          if (!boss) throw new Error("Queue unavailable");
          return createRunTools(db, boss, {
            connections,
            storage,
            pi,
          })(attempt, input, signal);
        },
      });
    boss = await startQueue(db, pool, {
      runtime,
      pi,
    });
    boss.on("stopped", () => {
      queueStopped = true;
    });
    const mail =
      config.MAIL_FROM && config.RESEND_API_KEY
        ? createResendMail({
            from: config.MAIL_FROM,
            apiKey: config.RESEND_API_KEY,
          })
        : null;
    const options = {
      db,
      boss,
      auth: createAuth(db, config.BETTER_AUTH_SECRET, config.OTTO_ORIGIN, mail),
      origin: config.OTTO_ORIGIN,
      storage,
      spool,
      transfer: {
        baseMs: config.TRANSFER_BASE_MS,
        minBytesPerSecond: config.TRANSFER_MIN_BYTES_PER_SECOND,
      },
      runtime,
      pi,
      connections,
      mail: mail ?? undefined,
      subscriptionLogin,
      modelGateway,
      transcriber: config.OPENROUTER_API_KEY
        ? createOpenRouterTranscriber({
            apiKey: config.OPENROUTER_API_KEY,
            model: config.TRANSCRIPTION_MODEL,
          })
        : undefined,
      gatewayStoreKey: gateway?.storeKey,
      cursors: createCursorCodec(config.BETTER_AUTH_SECRET),
    };
    let probe: Promise<boolean> | undefined;
    function isHealthy() {
      const health = runtime?.health();
      return (
        !closing &&
        !queueStopped &&
        !health?.persistenceErrors &&
        !health?.closing
      );
    }
    async function isReady() {
      if (!isHealthy()) return false;
      // Share concurrent probes; dependency timeouts remain bounded by their adapters.
      probe ??= (async () => {
        try {
          await pool.query("select version from queue.version");
          await storage?.check();
          if (modelGateway && !(await modelGateway.isReady())) return false;
          return isHealthy();
        } catch {
          return false;
        }
      })().finally(() => {
        probe = undefined;
      });
      return probe;
    }
    const app = createApp(options, { isReady });
    realtime = createRealtime(options);
    const transport = realtime;
    server = Bun.serve<RealtimeData>({
      hostname: config.HOST,
      port: config.PORT,
      // Only the binary upload route may stream more than the 1 MiB JSON cap enforced for every other route.
      maxRequestBodySize: MAX_FILE_BYTES + 1024 * 1024,
      idleTimeout: 30,
      websocket: transport.websocket,
      async fetch(request, server) {
        if (closing) return new Response(null, { status: 503 });
        if (new URL(request.url).pathname === "/api/realtime") {
          const data = await transport.prepare(request);
          if (data instanceof Response) return data;
          if (server.upgrade(request, { data })) return;
          return new Response(null, { status: 400 });
        }
        return app.fetch(request, server);
      },
      error() {
        return new Response(null, { status: 500 });
      },
    });
    logger.info(
      { port: server.port, storage: Boolean(storage), mail: Boolean(mail) },
      "server ready",
    );
    return { server, stop, isReady };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Server startup and cleanup failed",
      );
    }
    throw new Error(
      "Server startup failed; check configuration and run development schema push",
      { cause: error },
    );
  }
}
