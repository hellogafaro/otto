import { createApp } from "../../apps/server/src/app";
import { createAuth } from "../../apps/server/src/auth";
import { startQueue } from "../../apps/server/src/queue";
import { createCursorCodec } from "../../packages/db/src";
import { createS3Storage } from "../../packages/files/src/storage";
import { claimInstallation } from "../../packages/workspaces/src";
import { members, workspaces } from "../../packages/workspaces/src/schema";
import { startPostgres } from "../postgres";
import { startS3Peer } from "./s3-peer";
import { testSpool } from "./storage";

/** Real auth/Hono/PostgreSQL/queue and streamed AWS adapter; external S3 is a controlled disk peer. */
export async function startUiApp(origin: string, port = 0) {
  const database = await startPostgres();
  const peer = await startS3Peer();
  const transfers = await testSpool();
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const auth = createAuth(database.db, secret, origin);
  const boss = await startQueue(database.db, database.pool, {
    workers: true,
    install: true,
  });
  const storage = createS3Storage({
    endpoint: peer.endpoint,
    bucket: peer.bucket,
    region: "us-east-1",
    accessKeyId: "disposable-peer",
    secretAccessKey: "disposable-peer-not-a-live-credential",
  });
  const app = createApp(
    {
      db: database.db,
      auth,
      boss,
      origin,
      storage,
      spool: transfers.spool,
      cursors: createCursorCodec(secret),
    },
    { isReady: async () => true },
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => app.fetch(request),
  });
  let workspaceId: string | undefined;
  async function grant(
    userId: string,
    role: "owner" | "contributor" | "viewer" = "owner",
  ) {
    if (!workspaceId)
      workspaceId = (
        await claimInstallation(database.db, userId, "Otto walkthrough")
      ).id;
    else
      await database.db
        .insert(members)
        .values({ workspaceId, userId, role })
        .onConflictDoNothing();
    return workspaceId;
  }
  async function secondWorkspace(userId: string) {
    const [workspace] = await database.db
      .insert(workspaces)
      .values({ title: "Second workspace" })
      .returning();
    if (!workspace) throw new Error("Fixture workspace missing");
    await database.db
      .insert(members)
      .values({ workspaceId: workspace.id, userId, role: "owner" });
    return workspace.id;
  }
  return {
    origin,
    apiOrigin: server.url.origin,
    auth,
    database,
    peer,
    grant,
    secondWorkspace,
    async stop() {
      await server.stop(true);
      await boss.stop();
      await transfers.close();
      await peer.stop();
      await database.stop();
    },
  };
}
