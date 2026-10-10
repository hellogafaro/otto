import { publishNativeMessage } from "@otto/chats";
import { createCursorCodec, openDatabase } from "@otto/db";
import {
  getFile,
  MAX_FILE_BYTES,
  readFile,
  requireFileAudience,
  SMALL_FILE_BYTES,
  snapshotRunDocuments,
} from "@otto/library";
import { createS3Storage } from "@otto/library/storage";
import {
  assertRunAttempt,
  createRunRuntime,
  getRunExecutionModel,
  type RunRuntime,
  withRunAttempt,
} from "@otto/runs/runtime";
import { validateSchedule } from "@otto/schedules";
import {
  type NativeSessionStorage,
  openNativeStorage,
} from "@otto/sessions/native";
import { DomainError } from "@otto/shared";
import {
  authorizeSubscriptionModel,
  resolveSubscriptionModel,
} from "@otto/subscriptions/server";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createApp } from "./app";
import { createAuth } from "./auth";
import type { ComputerOptions } from "./computer";
import type { ServerConfig } from "./config";
import type { ConnectionOptions } from "./connections";
import { createLogger } from "./logger";
import { createSmtpMail, type Mail } from "./mail";
import { startQueue } from "./queue";
import { createRealtime, type RealtimeData } from "./realtime";
import { authorizeRunSources } from "./run-sources";
import * as schema from "./schema";
import { createSpool, type Spool } from "./spool";
import { createNativeRunTools, effectRequestId } from "./tools";
import { createOpenRouterTranscriber } from "./transcription";

/** Acquires resources in dependency order and releases every acquired resource on failure. */
export async function startServer(
  config: ServerConfig,
  services: {
    execution?: Pick<
      Parameters<typeof createRunRuntime>[1],
      "resolveModel" | "deadlineMs"
    >;
    connections?: ConnectionOptions;
    computer?: ComputerOptions;
    mail?: Mail | null;
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
  let native: NativeSessionStorage | undefined;
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
      await native?.close();
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
    native = await openNativeStorage({ connectionString: config.DATABASE_URL });
    const nativeStorage = native;
    const encryptionKey = Buffer.from(config.ENCRYPTION_KEY, "base64");
    const modelAuthorization = { authorizeModel: authorizeSubscriptionModel };
    const computer = services.computer
      ? (await import("./computer")).createComputer(services.computer)
      : undefined;
    await computer?.prepare();
    runtime = createRunRuntime(db, {
      storage: nativeStorage,
      deadlineMs: execution?.deadlineMs,
      cleanup: computer ? (attempt) => computer.cleanup(attempt) : undefined,
      resolveModel:
        execution?.resolveModel ??
        (async (attempt, signal) => {
          const accepted = await getRunExecutionModel(
            db,
            attempt,
            validateSchedule,
            nativeStorage,
            authorizeRunSources,
            snapshotRunDocuments,
          );
          return resolveSubscriptionModel(db, accepted, encryptionKey, signal);
        }),
      tools: (attempt, signal) => {
        if (!boss) throw new Error("Queue unavailable");
        const tools = createNativeRunTools(
          db,
          boss,
          attempt,
          {
            connections,
            storage,
            native: nativeStorage,
            models: modelAuthorization,
            cursors: createCursorCodec(config.BETTER_AUTH_SECRET),
          },
          signal,
        );
        if (computer)
          tools.computer_execute = computer.tool(attempt, signal, async () => {
            await withRunAttempt(
              db,
              attempt,
              async () => {},
              validateSchedule,
              nativeStorage,
              authorizeRunSources,
              snapshotRunDocuments,
            );
          });
        return tools;
      },
      publishOutput: async (attempt, output) => {
        const target = await withRunAttempt(
          db,
          attempt,
          async (c, run) => ({
            workspaceId: c.workspaceId,
            actor: c.actor,
            chatId: run.chatId,
            sessionId: run.sessionId,
          }),
          validateSchedule,
          nativeStorage,
          authorizeRunSources,
          snapshotRunDocuments,
        );
        if (!target.sessionId) throw new Error("Native Session unavailable");
        await publishNativeMessage(
          db,
          nativeStorage,
          target.workspaceId,
          target.actor,
          target.chatId,
          {
            requestId: effectRequestId(attempt.runId, output.nativeMessageId),
            sessionId: target.sessionId,
            ...output,
          },
          async (c) => {
            await assertRunAttempt(
              c,
              attempt,
              validateSchedule,
              nativeStorage,
              authorizeRunSources,
              snapshotRunDocuments,
            );
          },
        );
      },
      validateSchedule,
      authorizeSources: authorizeRunSources,
      readAttachments: async (attempt, signal) => {
        if (!storage)
          throw new DomainError("unavailable", "File storage unavailable");
        const authorize = () =>
          withRunAttempt(
            db,
            attempt,
            async (c, run) => {
              const ids = [
                ...new Set(
                  run.inputs.context?.messages.flatMap(
                    (message) => message.fileIds ?? [],
                  ) ?? [],
                ),
              ];
              const files = [];
              let size = 0;
              for (const id of ids) {
                await requireFileAudience(
                  c,
                  id,
                  run.inputs.audience.humans,
                  true,
                );
                const file = await getFile(c, id);
                size += file.byteLength;
                if (size > SMALL_FILE_BYTES || files.length >= 20)
                  throw new DomainError("invalid", "Native attachment limit");
                files.push(file);
              }
              return { workspaceId: c.workspaceId, actor: c.actor, files };
            },
            validateSchedule,
            nativeStorage,
            authorizeRunSources,
            snapshotRunDocuments,
          );
        const accepted = await authorize();
        const files = [];
        for (const file of accepted.files) {
          signal.throwIfAborted();
          const bytes = await readFile(
            db,
            storage,
            accepted.workspaceId,
            accepted.actor,
            file.id,
          );
          files.push({
            data: `data:${file.mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
            mediaType: file.mediaType,
            filename: file.title,
          });
        }
        signal.throwIfAborted();
        const current = await authorize();
        if (
          JSON.stringify(
            current.files.map((file) => [file.id, file.sha256, file.mediaType]),
          ) !==
          JSON.stringify(
            accepted.files.map((file) => [
              file.id,
              file.sha256,
              file.mediaType,
            ]),
          )
        )
          throw new DomainError(
            "conflict",
            "Native attachment sources changed",
          );
        return files;
      },
      snapshotDocuments: snapshotRunDocuments,
    });
    boss = await startQueue(db, pool, {
      runtime,
      modelAuthorization,
      nativeStorage,
    });
    boss.on("stopped", () => {
      queueStopped = true;
    });
    const mail =
      services.mail !== undefined
        ? services.mail
        : config.MAIL_FROM &&
            config.SMTP_HOST &&
            config.SMTP_PORT &&
            config.SMTP_TLS
          ? createSmtpMail({
              from: config.MAIL_FROM,
              host: config.SMTP_HOST,
              port: config.SMTP_PORT,
              tls: config.SMTP_TLS,
              user: config.SMTP_USER,
              password: config.SMTP_PASSWORD,
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
      modelAuthorization,
      nativeStorage,
      encryptionKey,
      connections,
      mail: mail ?? undefined,
      transcriber: config.OPENROUTER_API_KEY
        ? createOpenRouterTranscriber({
            apiKey: config.OPENROUTER_API_KEY,
            model: config.TRANSCRIPTION_MODEL,
          })
        : undefined,
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
      {
        port: server.port,
        storage: Boolean(storage),
        mail: Boolean(mail),
        transcription: Boolean(config.OPENROUTER_API_KEY),
        computer: Boolean(computer),
      },
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
