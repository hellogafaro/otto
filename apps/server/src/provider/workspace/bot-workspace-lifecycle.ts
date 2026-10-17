import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Match from "effect/Match";
import type { BotWorkspaceIO } from "./bot-workspace-io.ts";
import { Workspace } from "@mastra/core/workspace";
import {
  type RemoteBotSandbox,
  type OttoBotWorkspace,
  REMOTE_BOT_SANDBOXES,
} from "./bot-workspace-types.ts";

export function wrap(workspace: Workspace, provider: "local" | RemoteBotSandbox): OttoBotWorkspace {
  return {
    id: workspace.id,
    provider,
    workspace,
    inspect: async () =>
      Match.value(workspace.status).pipe(
        Match.when("destroyed", () => "missing" as const),
        Match.when("paused", () => "sleeping" as const),
        Match.orElse(() => "running" as const),
      ),
    wake: () => workspace.init(),
    sleep: () => workspace.stop(),
    destroy: () => workspace.destroy(),
  };
}

const decodeIdentity = Schema.decodeUnknownOption(
  Schema.Struct({ provider: Schema.Literals(REMOTE_BOT_SANDBOXES), providerId: Schema.String }),
);

export async function readIdentity(io: BotWorkspaceIO, path: string) {
  const content = await io.readIdentity(path);

  if (content === undefined) return undefined;
  const value = Option.getOrUndefined(decodeIdentity(JSON.parse(content)));

  if (!value || !value.providerId) throw new Error(`Workspace identity file '${path}' is invalid.`);

  return value;
}

export async function writeIdentity(
  io: BotWorkspaceIO,
  path: string,
  identity: { provider: RemoteBotSandbox; providerId: string },
) {
  await io.mkdir(io.path.dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  await io.writeIdentity(temporary, `${JSON.stringify(identity)}\n`);
  await io.rename(temporary, path);
}

export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** As in Mastra's sandboxes, the command is a shell line run as written; only the arguments are quoted. */
export const commandLine = (command: string, args: readonly string[]) =>
  args.length === 0 ? command : `${command} ${args.map(quote).join(" ")}`;

export function credential(environment: Readonly<Record<string, string>>, name: string): string {
  const value = environment[name]?.trim();

  if (!value) throw new Error(`Remote sandbox credential '${name}' is missing.`);

  return value;
}
