import { test as base, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { readConfig } from "../../apps/server/src/config";
import { startServer } from "../../apps/server/src/lifecycle";
import { startQueue } from "../../apps/server/src/queue";
import { ensureDefaultAgent } from "../../packages/agents/src/server";
import {
  type NativeActionInput,
  type NativeActionResult,
  nativeActionInput,
} from "../../packages/runs/src/action-schema";
import { runs } from "../../packages/runs/src/schema";
import { claimInstallation, inWorkspace } from "../../packages/workspaces/src";
import { members } from "../../packages/workspaces/src/schema";
import {
  controlledModel,
  fixtureEncryptionKey,
} from "../fixtures/native-model";
import { startS3Peer } from "../fixtures/s3-peer";
import { startPostgres } from "../postgres";

async function startNativeSettingsApp(origin: string) {
  const database = await startPostgres();
  let storage: Awaited<ReturnType<typeof startS3Peer>> | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const plans = new Map<string, NativeActionInput>();
  async function stop() {
    try {
      await server?.stop();
    } finally {
      try {
        await storage?.stop();
      } finally {
        await database.stop();
      }
    }
  }
  try {
    const installer = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await installer.stop();
    storage = await startS3Peer();
    server = await startServer(
      readConfig({
        DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
        BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
        ENCRYPTION_KEY: fixtureEncryptionKey.toString("base64"),
        OTTO_ORIGIN: origin,
        HOST: "127.0.0.1",
        PORT: "0",
        S3_ENDPOINT: storage.endpoint,
        S3_BUCKET: storage.bucket,
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "disposable-peer",
        S3_SECRET_ACCESS_KEY: "disposable-peer-not-a-live-credential",
        UPLOAD_SPOOL_DIR: `${database.directory}/spool`,
      }),
      {
        mail: null,
        execution: {
          deadlineMs: 60000,
          async resolveModel(attempt, signal) {
            const [run] = await database.db
              .select()
              .from(runs)
              .where(eq(runs.id, attempt.runId));
            const action = run && plans.get(run.inputs.body);
            if (!action)
              throw new Error(
                "Only an exact prepared Settings request may run",
              );
            const { type, ...input } = action;
            return controlledModel({
              signal,
              text: "Controlled native Settings approval",
              toolRequests: [
                { toolName: `request_${type.replaceAll(".", "_")}`, input },
              ],
            });
          },
        },
      },
    );
    let workspaceId: string | undefined;
    return {
      origin,
      apiOrigin: server.server.url.origin,
      database,
      async grant(
        userId: string,
        role: "owner" | "contributor" | "viewer" = "owner",
      ) {
        if (!workspaceId) {
          workspaceId = (
            await claimInstallation(
              database.db,
              userId,
              "Native Settings proof",
            )
          ).id;
          await inWorkspace(
            database.db,
            workspaceId,
            { userId },
            ensureDefaultAgent,
          );
        } else {
          await database.db
            .insert(members)
            .values({ workspaceId, userId, role })
            .onConflictDoNothing();
        }
        return workspaceId;
      },
      plan(action: NativeActionInput) {
        nativeActionInput.parse(action);
        const text = `Please propose this exact synthetic Settings action for my approval:\n${JSON.stringify(action)}`;
        plans.set(text, action);
        return text;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

type NativeSettingsFixture = Awaited<ReturnType<typeof startNativeSettingsApp>>;

export const nativeSettingsTest = base.extend<{
  fixture: NativeSettingsFixture;
}>({
  fixture: [
    async ({ playwright: _playwright }, use) => {
      const fixture = await startNativeSettingsApp("http://127.0.0.1:45183");
      let web: ReturnType<typeof Bun.spawn> | undefined;
      try {
        web = Bun.spawn(
          [
            process.execPath,
            "--bun",
            "run",
            "--cwd",
            "apps/web",
            "dev",
            "--host",
            "127.0.0.1",
            "--port",
            "45183",
            "--strictPort",
          ],
          {
            stdout: "ignore",
            stderr: "ignore",
            env: { ...process.env, OTTO_API_ORIGIN: fixture.apiOrigin },
          },
        );
        await expect
          .poll(
            async () => (await fetch(fixture.origin).catch(() => null))?.ok,
            {
              timeout: 20000,
            },
          )
          .toBe(true);
        await use(fixture);
      } finally {
        try {
          if (web) {
            web.kill("SIGTERM");
            await web.exited;
          }
        } finally {
          await fixture.stop();
        }
      }
    },
    { scope: "test", timeout: 120000 },
  ],
});

export async function prepareNativeSettings(
  page: Page,
  fixture: NativeSettingsFixture,
  workspaceId: string,
) {
  const prefix = `/api/workspaces/${workspaceId}`;
  const headers = { origin: fixture.origin };
  const accountResponse = await page.request.post(`${prefix}/subscriptions`, {
    headers,
    data: {
      title: "Controlled Settings account",
      provider: "openai",
      protocol: "responses",
      models: ["fixture"],
      visibility: "user",
    },
  });
  expect(accountResponse.status()).toBe(200);
  const account = (await accountResponse.json()) as { id: string };
  expect(
    (
      await page.request.put(`${prefix}/subscriptions/${account.id}/api-key`, {
        headers,
        data: { apiKey: "fixture-not-a-live-key" },
      })
    ).status(),
  ).toBe(200);
  const agentResponse = await page.request.post(`${prefix}/agents`, {
    headers,
    data: {
      title: "Settings approval Agent",
      instructions:
        "Request only the exact synthetic action the human asks for.",
      subscriptionId: account.id,
      model: "fixture",
      visibility: "workspace",
    },
  });
  expect(agentResponse.status()).toBe(200);
  const { agent } = (await agentResponse.json()) as {
    agent: { id: string; title: string };
  };
  const chatResponse = await page.request.post(`${prefix}/chats`, {
    headers,
    data: { title: "Native Settings approvals", visibility: "participants" },
  });
  expect(chatResponse.status()).toBe(200);
  const chat = (await chatResponse.json()) as { id: string; title: string };
  expect(
    (
      await page.request.post(`${prefix}/chats/${chat.id}/participants`, {
        headers,
        data: { agentId: agent.id, role: "contributor" },
      })
    ).status(),
  ).toBe(200);
  async function propose(input: NativeActionInput) {
    await page.goto(`/chats/${chat.id}`);
    const text = fixture.plan(input);
    const composer = page.getByRole("textbox", {
      name: `Message ${chat.title}, @ to tag`,
      exact: true,
    });
    await composer.fill(text);
    const admission = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `${prefix}/chats/${chat.id}/messages`,
    );
    await composer.press("Enter");
    const admitted = await admission;
    expect(admitted.status()).toBe(200);
    expect(admitted.request().postDataJSON().body).toBe(text);
    const message = (await admitted.json()) as {
      id: string;
      replyErrors: unknown[];
    };
    expect(message.replyErrors).toEqual([]);
    const replies = await fixture.database.db
      .select()
      .from(runs)
      .where(eq(runs.chatId, chat.id));
    const run = replies.find((item) =>
      item.inputs.context?.messages.some((source) => source.id === message.id),
    );
    if (!run) throw new Error("Acknowledged Chat reply missing");
    await expect(
      page.getByRole("button", { name: "Approve exact action", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    const pending = await page.request.get(`${prefix}/runs/${run.id}/actions`);
    expect(pending.status()).toBe(200);
    const { items } = (await pending.json()) as {
      items: {
        id: string;
        digest: string;
        status: string;
        input: NativeActionInput;
      }[];
    };
    expect(items).toHaveLength(1);
    const action = items[0];
    if (!action) throw new Error("Native request missing");
    expect(action.input).toEqual(input);
    expect(action.status).toBe("pending");
    return {
      runId: run.id,
      action,
      resolutionPath: `${prefix}/runs/${run.id}/actions/${action.id}/resolve`,
    };
  }
  return {
    agent,
    chat,
    propose,
    async approve(input: NativeActionInput) {
      const proposed = await propose(input);
      const resolution = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === proposed.resolutionPath,
      );
      await page
        .getByRole("button", { name: "Approve exact action", exact: true })
        .click();
      const response = await resolution;
      expect(response.status()).toBe(200);
      expect(response.request().postDataJSON()).toEqual({
        decision: "approve",
        digest: proposed.action.digest,
      });
      const receipt = (await response.json()) as {
        status: string;
        result: NativeActionResult;
      };
      expect(receipt.status).toBe("approved");
      const id = receipt.result.id;
      if (!id) throw new Error("Native Settings result has no id");
      await expect
        .poll(
          async () => {
            const current = await page.request.get(
              `${prefix}/runs/${proposed.runId}`,
            );
            expect(current.status()).toBe(200);
            return (await current.json()).state;
          },
          { timeout: 20000 },
        )
        .toBe("finished");
      return { ...receipt.result, id };
    },
  };
}
