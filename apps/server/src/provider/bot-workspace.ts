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
import {
  wrap,
  readIdentity,
  writeIdentity,
  credential,
} from "./workspace/bot-workspace-lifecycle.ts";
import { RemoteSandbox } from "./workspace/remote-sandbox.ts";
import { boat, boatFailure } from "./workspace/adapters/boat.ts";
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
  const identityFile = input.identityFile;
  const persisted = await readIdentity(input.io, identityFile);

  if (persisted && persisted.provider !== input.sandbox)
    throw new Error(
      `Workspace '${input.workspaceId}' belongs to '${persisted.provider}', not '${input.sandbox}'.`,
    );
  let session: OttoRemoteSession;

  try {
    session = input.openSession
      ? await input.openSession(persisted?.providerId)
      : await connect(input.sandbox, input.workspaceId, input.environment, persisted?.providerId);
  } catch (cause) {
    if (!persisted) throw cause;
    throw new Error(`Remote ${input.sandbox} workspace '${persisted.providerId}' is unavailable.`, {
      cause,
    });
  }

  if (!persisted || persisted.providerId !== session.providerId) {
    try {
      await writeIdentity(input.io, identityFile, {
        provider: input.sandbox,
        providerId: session.providerId,
      });
    } catch (cause) {
      await session.destroy().catch(() => undefined);
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
    wake: () => workspace.init(),
    sleep: () => workspace.stop(),
    destroy: async () => {
      await workspace.destroy();
      await input.io.remove(identityFile);
    },
  };
}

async function connect(
  provider: RemoteBotSandbox,
  id: string,
  environment: Readonly<Record<string, string>> = {},
  providerId?: string,
): Promise<OttoRemoteSession> {
  // A confirmed-missing VM is replaced; any other failure keeps the saved identity.
  const reattach = providerId ? { sandboxId: providerId } : {};

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
    }
  }

  const { sandbox } = await client
    .create({ createSandboxRequest: { ttlSeconds: null, noEnv: true } })
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
