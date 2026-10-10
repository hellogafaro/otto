import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readConfig } from "../../apps/server/src/config";
import { startServer } from "../../apps/server/src/lifecycle";
import { startQueue } from "../../apps/server/src/queue";
import { createAgent } from "../../packages/agents/src";
import { createChat, createParticipant } from "../../packages/chats/src";
import { createEnvironment } from "../../packages/environments/src";
import { runs } from "../../packages/runs/src/schema";
import { claimInstallation, inWorkspace } from "../../packages/workspaces/src";
import { members } from "../../packages/workspaces/src/schema";
import { startPostgres } from "../postgres";
import { controlledSubscription, fixtureEncryptionKey } from "./native-model";

export async function startStreamingApp(origin: string) {
  const database = await startPostgres();
  const installer = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  await installer.stop();
  const controls = new Map<
    string,
    { delta(text: string): void; finish(): void }
  >();
  const server = await startServer(
    readConfig({
      DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
      BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      ENCRYPTION_KEY: Buffer.from(fixtureEncryptionKey).toString("base64"),
      OTTO_ORIGIN: origin,
      PORT: "0",
    }),
    {
      mail: null,
      execution: {
        deadlineMs: 120000,
        async resolveModel(attempt, signal) {
          const [run] = await database.db
            .select()
            .from(runs)
            .where(eq(runs.id, attempt.runId));
          if (!run) throw new Error("Missing fixture Run");
          return new MastraLanguageModelV2Mock({
            provider: "controlled-fixture",
            modelId: "fixture",
            supportedUrls: {},
            async doStream() {
              return {
                stream: new ReadableStream({
                  start(controller) {
                    controller.enqueue({ type: "stream-start", warnings: [] });
                    controller.enqueue({
                      type: "reasoning-start",
                      id: "private-reasoning",
                    });
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: "private-reasoning",
                      delta: "NEVER_STREAM_REASONING",
                    });
                    controller.enqueue({
                      type: "reasoning-end",
                      id: "private-reasoning",
                    });
                    controller.enqueue({
                      type: "text-start",
                      id: "fixture-text",
                    });
                    const abort = () => {
                      controls.delete(run.id);
                      controller.error(new Error("Controlled native abort"));
                    };
                    const control = {
                      delta(text: string) {
                        controller.enqueue({
                          type: "text-delta",
                          id: "fixture-text",
                          delta: text,
                        });
                      },
                      finish() {
                        signal.removeEventListener("abort", abort);
                        controls.delete(run.id);
                        controller.enqueue({
                          type: "text-end",
                          id: "fixture-text",
                        });
                        controller.enqueue({
                          type: "finish",
                          finishReason: "stop",
                          usage: {
                            inputTokens: 4,
                            outputTokens: 2,
                            totalTokens: 6,
                          },
                        });
                        controller.close();
                      },
                    };
                    controls.set(run.id, control);
                    signal.addEventListener("abort", abort, { once: true });
                    control.delta(`${run.inputs.body} first`);
                  },
                }),
              };
            },
          });
        },
      },
    },
  );
  const apiOrigin = server.server.url.origin;
  let workspaceId = "";
  async function register(name: string) {
    const email = `${crypto.randomUUID()}@example.test`;
    const password = crypto.randomUUID() + crypto.randomUUID();
    const send = (path: string, input: unknown) =>
      fetch(`${apiOrigin}/api/auth/${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    const signup = await send("sign-up/email", { name, email, password });
    if (!signup.ok) throw new Error(`Fixture sign-up failed: ${signup.status}`);
    const user = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signup.json()).user;
    const login = await send("sign-in/email", { email, password });
    if (!login.ok) throw new Error(`Fixture sign-in failed: ${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Fixture login cookie absent");
    if (!workspaceId)
      workspaceId = (
        await claimInstallation(database.db, user.id, "Streaming fixture")
      ).id;
    else
      await database.db
        .insert(members)
        .values({ workspaceId, userId: user.id, role: "contributor" });
    return { ...user, cookie };
  }
  async function setup(ownerId: string, otherId?: string) {
    return inWorkspace(
      database.db,
      workspaceId,
      { userId: ownerId },
      async (c) => {
        const subscriptionId = await controlledSubscription(c);
        const agentIds: string[] = [];
        const chat = await createChat(c, {
          title: "Native streaming proof",
          visibility: "participants",
        });
        if (otherId)
          await createParticipant(c, chat.id, {
            userId: otherId,
            role: "contributor",
          });
        for (const title of ["Stream Alpha", "Stream Beta"]) {
          const agent = await createAgent(c, {
            title,
            instructions: "Controlled streaming fixture",
            model: "fixture",
            subscriptionId,
            visibility: "workspace",
          });
          await createEnvironment(c, agent.id);
          await createParticipant(c, chat.id, {
            agentId: agent.id,
            role: "contributor",
          });
          agentIds.push(agent.id);
        }
        return {
          chatId: chat.id,
          agentIds: z.tuple([z.uuid(), z.uuid()]).parse(agentIds),
          workspaceId,
        };
      },
    );
  }
  async function request(cookie: string, path: string, input?: unknown) {
    return fetch(`${apiOrigin}/api/workspaces/${workspaceId}${path}`, {
      method: input === undefined ? "GET" : "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  }
  return {
    origin,
    apiOrigin,
    database,
    controls,
    register,
    setup,
    request,
    async stop() {
      await server.stop();
      await database.stop();
    },
  };
}
