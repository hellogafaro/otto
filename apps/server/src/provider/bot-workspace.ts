import * as NodeCrypto from "node:crypto";
import { TOOL_NAME_OVERRIDES } from "@mastra/code-sdk/tool-names";
import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import type { BotSandbox } from "@otto/contracts";
import { BotWorkspaceFilesystem } from "./bot-workspace-filesystem.ts";
import {
  type RemoteBotSandbox,
  REMOTE_BOT_SANDBOXES,
  type CreateBotWorkspaceInput,
  type OttoBotWorkspace,
  type CreateRemoteBotWorkspaceInput,
  type OttoRemoteSession,
} from "./workspace/bot-workspace-types.ts";
import * as Predicate from "effect/Predicate";
import {
  type BotWorkspaceRecord,
  wrap,
  readIdentity,
  writeIdentity,
  credential,
} from "./workspace/bot-workspace-lifecycle.ts";
import { RemoteSandbox } from "./workspace/remote-sandbox.ts";
import { BOAT_TTL_SECONDS, boat, boatFailure } from "./workspace/adapters/boat.ts";
import { e2b } from "./workspace/adapters/e2b.ts";
import { daytona } from "./workspace/adapters/daytona.ts";
import { vercel, vercelCredentials } from "./workspace/adapters/vercel.ts";
import { railway, railwayCredentials } from "./workspace/adapters/railway.ts";

export function isRemoteBotSandbox(
  value: BotSandbox | null | undefined,
): value is RemoteBotSandbox {
  return REMOTE_BOT_SANDBOXES.some((provider) => provider === value);
}

export async function createBotWorkspace(
  input: CreateBotWorkspaceInput,
): Promise<OttoBotWorkspace | undefined> {
  if (isRemoteBotSandbox(input.sandbox)) {
    const remote = await (input.makeRemoteWorkspace ?? createRemoteBotWorkspace)({
      io: input.io,
      threadId: input.threadId,
      sandbox: input.sandbox,
      ...(input.identityFile ? { identityFile: input.identityFile } : {}),
      ...(input.legacyIdentityFile ? { legacyIdentityFile: input.legacyIdentityFile } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.environment ? { environment: input.environment } : {}),
    });

    return remote instanceof Workspace ? wrap(remote, input.sandbox) : remote;
  }

  const root = input.localRoot ?? input.cwd;

  if (!root) return undefined;
  await input.io.mkdir(root);
  const isolation = LocalSandbox.detectIsolation();

  const profile = input.sandboxProfileDirectory
    ? {
        seatbeltProfilePath: input.io.path.join(
          input.sandboxProfileDirectory,
          `${NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 16)}.sb`,
        ),
      }
    : {};

  const workspace = new Workspace({
    id: input.workspaceId ?? `otto-${input.threadId}`,
    name: `Otto ${input.threadId}`,
    filesystem: new LocalFilesystem({ basePath: root }),
    sandbox: new LocalSandbox({
      workingDirectory: root,
      ...(isolation.available
        ? { isolation: isolation.backend, nativeSandbox: { allowNetwork: true, ...profile } }
        : {}),
    }),
    tools: TOOL_NAME_OVERRIDES,
  });

  return wrap(workspace, "local");
}

export async function createRemoteBotWorkspace(
  input: CreateRemoteBotWorkspaceInput,
): Promise<OttoBotWorkspace> {
  if (!input.identityFile || !input.workspaceId)
    throw new Error(`Remote sandbox '${input.sandbox}' needs a stable workspace identity.`);
  const { identityFile, legacyIdentityFile } = input;

  const persisted =
    (await readIdentity(input.io, identityFile)) ??
    (legacyIdentityFile ? await readIdentity(input.io, legacyIdentityFile) : undefined);

  if (persisted && persisted.provider !== input.sandbox)
    throw new Error(
      `Workspace '${input.workspaceId}' belongs to '${persisted.provider}', not '${input.sandbox}'.`,
    );
  const owner = { provider: input.sandbox, scope: input.threadId };
  let session: OttoRemoteSession;

  try {
    const opened = input.openSession
      ? await input.openSession(persisted?.providerId)
      : await connect(input.sandbox, input.workspaceId, input.environment, persisted, (createKey) =>
          writeIdentity(input.io, identityFile, { ...owner, createKey }),
        );

    if (!opened) throw new Error(`Remote ${input.sandbox} workspace is missing.`);
    session = opened;
  } catch (cause) {
    if (!persisted?.providerId) throw cause;
    throw new Error(`Remote ${input.sandbox} workspace '${persisted.providerId}' is unavailable.`, {
      cause,
    });
  }

  const created = persisted?.providerId !== session.providerId;

  const record = {
    ...owner,
    providerId: session.providerId,
    ...(!created && persisted?.usedAt ? { usedAt: persisted.usedAt } : {}),
  };

  if (JSON.stringify(record) !== JSON.stringify(persisted)) {
    try {
      await writeIdentity(input.io, identityFile, record);

      if (legacyIdentityFile) await input.io.remove(legacyIdentityFile);
    } catch (cause) {
      if (created) await session.destroy().catch(() => undefined);
      throw cause;
    }
  }

  const workspace = new Workspace({
    id: input.workspaceId,
    name: `Otto ${input.workspaceId}`,
    filesystem: new BotWorkspaceFilesystem(input.workspaceId, input.sandbox, session),
    sandbox: new RemoteSandbox(input.workspaceId, input.sandbox, session),
    tools: TOOL_NAME_OVERRIDES,
  });

  return {
    id: input.workspaceId,
    provider: input.sandbox,
    providerId: session.providerId,
    workspace,
    inspect: session.inspect,
    ...(session.desktopUrl ? { desktopUrl: session.desktopUrl } : {}),
    ...(session.keepAlive ? { keepAlive: session.keepAlive } : {}),
    wake: () => workspace.init(),
    sleep: () => workspace.stop(),
    destroy: async () => {
      await workspace.destroy();
      await input.io.remove(identityFile);
    },
  };
}

/**
 * Deletes a recorded computer at its provider without creating one; a computer the provider
 * no longer has counts as deleted.
 */
export async function destroyRemoteComputer(input: {
  readonly provider: RemoteBotSandbox;
  readonly workspaceId: string;
  readonly record: BotWorkspaceRecord;
  readonly environment: Readonly<Record<string, string>>;
}): Promise<void> {
  if (!input.record.providerId && !input.record.createKey) return;

  try {
    const session = await connect(
      input.provider,
      input.workspaceId,
      input.environment,
      input.record,
      async () => undefined,
      { replaceMissing: false },
    );

    await session?.destroy();
  } catch (cause) {
    const { ResponseError } = await import("@boatdev/sdk");

    if (cause instanceof ResponseError && cause.response.status === 404) return;

    if (Predicate.hasProperty(cause, "code") && cause.code === "SANDBOX_REATTACH_FAILED") return;
    throw input.provider === "boat" ? await boatFailure(cause) : cause;
  }
}

async function connect(
  provider: RemoteBotSandbox,
  id: string,
  environment: Readonly<Record<string, string>> = {},
  persisted: BotWorkspaceRecord | undefined,
  saveCreateKey: (createKey: string) => Promise<void>,
  options: { readonly replaceMissing: boolean } = { replaceMissing: true },
): Promise<OttoRemoteSession | undefined> {
  const providerId = persisted?.providerId;

  // A confirmed-missing VM is replaced; any other failure keeps the saved identity.
  const reattach = providerId
    ? {
        sandboxId: providerId,
        ...(options.replaceMissing ? {} : { reattach: "required" as const }),
      }
    : {};

  if (provider === "e2b") {
    const { E2BSandbox } = await import("@mastra/e2b");
    const apiKey = credential(environment, "E2B_API_KEY");

    const sandbox = new E2BSandbox({
      id,
      apiKey,
      lifecycle: { onTimeout: "pause" },
      network: { allowPublicTraffic: false },
      ...reattach,
    });

    await sandbox._start();

    return e2b(sandbox, apiKey);
  }

  if (provider === "daytona") {
    const { DaytonaSandbox } = await import("@mastra/daytona");

    const sandbox = new DaytonaSandbox({
      id,
      name: id,
      apiKey: credential(environment, "DAYTONA_API_KEY"),
    });

    await sandbox._start();

    return daytona(sandbox);
  }

  if (provider === "vercel") {
    const { VercelSandbox } = await import("@mastra/vercel");
    const credentials = vercelCredentials(environment);
    const sandbox = new VercelSandbox({ id, sandboxName: id, ...credentials });
    await sandbox._start();

    return vercel(sandbox, credentials);
  }

  if (provider === "railway") {
    const { RailwaySandbox } = await import("@mastra/railway");
    const credentials = await railwayCredentials(environment);
    const sandbox = new RailwaySandbox({ id, ...credentials, ...reattach });
    await sandbox._start();

    return railway(sandbox, credentials);
  }

  const { BoatApi, Configuration, ResponseError } = await import("@boatdev/sdk");

  const client = new BoatApi(
    new Configuration({ accessToken: credential(environment, "BOAT_API_KEY") }),
  );

  if (providerId) {
    try {
      await client.get({ sandboxId: providerId });

      return boat(client, providerId);
    } catch (cause) {
      // A timed-out deletion can finish later; only confirmed absence permits replacement.
      if (!(cause instanceof ResponseError) || cause.response.status !== 404) throw cause;

      if (!options.replaceMissing) return undefined;
    }
  }

  // A create whose VM was never recorded retries with its key, so Boat returns that VM.
  const createKey =
    !providerId && persisted?.createKey ? persisted.createKey : NodeCrypto.randomUUID();

  await saveCreateKey(createKey);

  const { sandbox } = await client
    .create({
      idempotencyKey: createKey,
      createSandboxRequest: { ttlSeconds: BOAT_TTL_SECONDS, noEnv: true },
    })
    .catch(async (cause: unknown) => {
      throw await boatFailure(cause);
    });

  return boat(client, sandbox.id);
}

export {
  REMOTE_BOT_SANDBOXES,
  type RemoteBotSandbox,
  type OttoWorkspaceState,
  type OttoBotWorkspace,
  type OttoRemoteSession,
  type CreateRemoteBotWorkspaceInput,
  type CreateBotWorkspaceInput,
} from "./workspace/bot-workspace-types.ts";

export { railway, railwayWorkspaceState } from "./workspace/adapters/railway.ts";

export { boat } from "./workspace/adapters/boat.ts";

export { e2b } from "./workspace/adapters/e2b.ts";

export { daytona } from "./workspace/adapters/daytona.ts";

export { vercelWorkspaceState, vercel } from "./workspace/adapters/vercel.ts";
