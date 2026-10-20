import * as NodeCrypto from "node:crypto";
import {
  COMPOSIO_BOT_ACCESS_DEFAULT,
  type ComposioOperationError,
  type ComposioVisibility,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { operationError } from "./composio-client.ts";

/** Otto's record of one connected account: Composio itself only knows the server's one user. */
export interface ComposioAccountRecord {
  readonly connectionId: string;
  readonly createdBy: string | null;
  readonly createdByName: string | null;
  /** The label the person typed. Older accounts have none and show Composio's bare alias. */
  readonly label: string | null;
  readonly visibility: ComposioVisibility;
  /** Per-bot choices that differ from the default, by bot id. */
  readonly botAccess: Readonly<Record<string, boolean>>;
}

export interface ComposioAccountStore {
  readonly list: Effect.Effect<readonly ComposioAccountRecord[], ComposioOperationError>;
  readonly save: (record: ComposioAccountRecord) => Effect.Effect<void, ComposioOperationError>;
  readonly remove: (connectionId: string) => Effect.Effect<void, ComposioOperationError>;
}

/** The signed-in person managing accounts. */
export interface ComposioViewer {
  readonly personId: string;
  readonly displayName: string;
}

/**
 * Workspace accounts (and accounts connected before Otto recorded owners) serve
 * everyone. A personal account serves the person who connected it and the bots that
 * person owns: anyone chatting with such a bot uses it without seeing it.
 */
export function composioAccountVisibleTo(
  record: ComposioAccountRecord | undefined,
  personId: string | null,
): boolean {
  return (
    record === undefined ||
    record.visibility === "organization" ||
    (personId !== null && record.createdBy === personId)
  );
}

/** The bot a chat runs as: which one, and the person who owns it. */
export interface ComposioBot {
  readonly botId: string | null;
  readonly ownerPersonId: string | null;
}

/**
 * Whether an account serves a bot: its per-bot switch when set, else the default. A new
 * account starts off for every bot. An older one serves the team, or the bots its owner owns.
 */
export function composioAccountServesBot(
  record: ComposioAccountRecord | undefined,
  bot: ComposioBot,
): boolean {
  const choice = bot.botId === null ? undefined : record?.botAccess[bot.botId];

  if (choice !== undefined) return choice;

  if (record?.botAccess[COMPOSIO_BOT_ACCESS_DEFAULT] === false) return false;

  return composioAccountVisibleTo(record, bot.ownerPersonId);
}

const decodeBotAccess = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Boolean)),
);

/** What people see an account called: the label they typed, else an older account's bare alias. */
export function accountLabel(
  record: ComposioAccountRecord | undefined,
  connection: { readonly alias?: string | undefined },
): string | undefined {
  return record?.label ?? connection.alias;
}

/**
 * The alias Composio gets. Everyone shares one Composio user, which needs aliases unique per
 * app, so this one carries its owner: their name for bots to read, and a short tag from their
 * person id because two people can share a name.
 */
export function composioAccountAlias(viewer: ComposioViewer, label: string): string {
  const tag = NodeCrypto.createHash("sha256").update(viewer.personId).digest("hex").slice(0, 6);

  return `${viewer.displayName} · ${label} · ${tag}`;
}

export function manageableBy(record: ComposioAccountRecord | undefined, personId: string): boolean {
  return record === undefined || record.createdBy === null || record.createdBy === personId;
}

export function inMemoryComposioAccounts(): ComposioAccountStore {
  const records = new Map<string, ComposioAccountRecord>();

  return {
    list: Effect.sync(() => [...records.values()]),
    save: (record) => Effect.sync(() => void records.set(record.connectionId, record)),
    remove: (connectionId) => Effect.sync(() => void records.delete(connectionId)),
  };
}

export const sqlComposioAccounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fail = (operation: string) => (cause: unknown) => operationError(operation, cause);

  const store: ComposioAccountStore = {
    list: sql<{
      readonly connection_id: string;
      readonly created_by: string | null;
      readonly created_by_name: string | null;
      readonly label: string | null;
      readonly visibility: ComposioVisibility;
      readonly bot_access_json: string;
    }>`SELECT connection_id, created_by, created_by_name, label, visibility, bot_access_json FROM composio_accounts`.pipe(
      Effect.map((rows) =>
        rows.map(
          (row): ComposioAccountRecord => ({
            connectionId: row.connection_id,
            createdBy: row.created_by,
            createdByName: row.created_by_name,
            label: row.label,
            visibility: row.visibility,
            botAccess: Option.getOrElse(decodeBotAccess(row.bot_access_json), () => ({})),
          }),
        ),
      ),
      Effect.mapError(fail("load account owners")),
    ),
    save: (record) =>
      sql`
        INSERT INTO composio_accounts (connection_id, created_by, created_by_name, label, visibility, bot_access_json, created_at)
        VALUES (${record.connectionId}, ${record.createdBy}, ${record.createdByName}, ${record.label}, ${record.visibility}, ${JSON.stringify(record.botAccess)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT (connection_id) DO UPDATE SET
          visibility = excluded.visibility,
          bot_access_json = excluded.bot_access_json,
          created_by = COALESCE(composio_accounts.created_by, excluded.created_by),
          created_by_name = COALESCE(composio_accounts.created_by_name, excluded.created_by_name),
          label = COALESCE(composio_accounts.label, excluded.label)
      `.pipe(Effect.asVoid, Effect.mapError(fail("save the account owner"))),
    remove: (connectionId) =>
      sql`DELETE FROM composio_accounts WHERE connection_id = ${connectionId}`.pipe(
        Effect.asVoid,
        Effect.mapError(fail("forget the account owner")),
      ),
  };

  return store;
});
