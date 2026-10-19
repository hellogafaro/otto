import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Match from "effect/Match";
import type { BotWorkspaceIO } from "./bot-workspace-io.ts";
import { Workspace } from "@mastra/core/workspace";
import { type RemoteBotSandbox, type OttoBotWorkspace } from "./bot-workspace-types.ts";

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

/**
 * One record per computer, written before the provider creates it: who owns it (`scope` is
 * `{botId}_{chatId}` or `thread-{chatId}`), the provider's id once created, Boat's
 * idempotency key, and when a session last opened it. Retired providers stay in the
 * schema so leftover identity files decode and the sweep can drop them.
 */
const BotWorkspaceRecord = Schema.Struct({
  provider: Schema.Literals([
    "local",
    "boat",
    "e2b",
    "daytona",
    "vercel",
    "railway",
    "ascii",
    "upstash",
    "tenki",
    "otto-cloud",
  ]),
  providerId: Schema.optional(Schema.String),
  createKey: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  usedAt: Schema.optional(Schema.String),
  orphanedAt: Schema.optional(Schema.String),
});

export type BotWorkspaceRecord = typeof BotWorkspaceRecord.Type;

const decodeRecord = Schema.decodeUnknownOption(BotWorkspaceRecord);

export async function readIdentity(
  io: BotWorkspaceIO,
  path: string,
): Promise<BotWorkspaceRecord | undefined> {
  const content = await io.readIdentity(path);

  if (content === undefined) return undefined;
  const value = Option.getOrUndefined(decodeRecord(JSON.parse(content)));

  if (!value || value.providerId === "")
    throw new Error(`Workspace identity file '${path}' is invalid.`);

  return value;
}

export async function writeIdentity(io: BotWorkspaceIO, path: string, record: BotWorkspaceRecord) {
  await io.mkdir(io.path.dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  await io.writeIdentity(temporary, `${JSON.stringify(record)}\n`);
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
