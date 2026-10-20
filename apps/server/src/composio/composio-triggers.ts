import { ComposioOperationError, type ComposioConnection } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ServerSecretStore } from "../auth/server-secret-store.ts";
import {
  accountLabel,
  type ComposioAccountStore,
  composioAccountServesBot,
  composioAccountVisibleTo,
} from "./composio-accounts.ts";
import { type ComposioClient, isNotFoundError, operationError } from "./composio-client.ts";
import type {
  ComposioServiceShape,
  ComposioTriggerRecord,
  ComposioWebhookDelivery,
} from "./composio-service.ts";

const WEBHOOK_SECRET = "composio-webhook-secret";

/** The settings an app event needs, from the JSON schema Composio gives for its config. */
const decodeRequiredConfig = Schema.decodeUnknownOption(
  Schema.Struct({ required: Schema.Array(Schema.String) }),
);

type ConnectionSummary = Pick<
  ComposioConnection,
  "id" | "toolkitSlug" | "status" | "alias" | "accountName"
>;

/** What app triggers need from the Composio service. */
interface ComposioTriggerDependencies {
  readonly secretStore: ServerSecretStore["Service"];
  readonly accounts: ComposioAccountStore;
  readonly withClient: <A>(
    operation: string,
    run: (client: ComposioClient, userId: string) => Promise<A>,
  ) => Effect.Effect<A, ComposioOperationError>;
  readonly listConnections: (
    client: ComposioClient,
    userId: string,
  ) => Promise<ReadonlyArray<ConnectionSummary>>;
  readonly loadCatalog: (
    client: ComposioClient,
    userId: string,
  ) => Promise<ReadonlyArray<{ readonly slug: string; readonly name: string }>>;
  readonly listTriggerTypes: (
    client: ComposioClient,
    toolkitSlug: string,
  ) => Promise<Awaited<ReturnType<ComposioClient["triggers"]["listTypes"]>>["items"]>;
}

/** Composio app triggers for routines, and the webhook that delivers their events. */
export function composioTriggers({
  secretStore,
  accounts,
  withClient,
  listConnections,
  loadCatalog,
  listTriggerTypes,
}: ComposioTriggerDependencies): Pick<
  ComposioServiceShape,
  | "prepareTrigger"
  | "checkTriggerAccount"
  | "listTriggers"
  | "createTrigger"
  | "setTriggerEnabled"
  | "deleteTrigger"
  | "subscribeWebhook"
  | "verifyWebhook"
> {
  const prepareTrigger: ComposioServiceShape["prepareTrigger"] = (input, bot, personId) =>
    Effect.flatMap(accounts.list, (records) => {
      const owners = new Map(records.map((record) => [record.connectionId, record]));

      return withClient("set up the app trigger", async (client, userId) => {
        const app = input.app.trim().toLowerCase();

        const toolkit = (await loadCatalog(client, userId)).find(
          (candidate) => candidate.slug === app || candidate.name.toLowerCase() === app,
        );

        if (!toolkit) throw new Error(`Composio does not list ${input.app}.`);
        const events = await listTriggerTypes(client, toolkit.slug);
        const wanted = input.event.trim().toLowerCase();

        const event = events.find(
          (candidate) =>
            candidate.slug.toLowerCase() === wanted || candidate.name.toLowerCase() === wanted,
        );

        if (!event) {
          throw new Error(
            events.length === 0
              ? `${toolkit.name} reports no events.`
              : `${toolkit.name} has no event ${input.event}. Its events: ${events.map((candidate) => `${candidate.slug} (${candidate.name})`).join(", ")}.`,
          );
        }

        const config = input.config ?? {};

        const required = Option.match(decodeRequiredConfig(event.config), {
          onNone: () => [],
          onSome: (schema) => schema.required,
        });

        const missing = required.filter((key) => config[key] === undefined);

        if (missing.length > 0) {
          throw new Error(`${event.name} needs ${missing.join(", ")} in config.`);
        }

        const usable = (await listConnections(client, userId)).filter(
          (connection) =>
            connection.toolkitSlug === toolkit.slug &&
            connection.status === "ACTIVE" &&
            composioAccountVisibleTo(owners.get(connection.id), personId) &&
            composioAccountServesBot(owners.get(connection.id), bot),
        );

        const names = (connection: (typeof usable)[number]) =>
          [accountLabel(owners.get(connection.id), connection), connection.accountName].filter(
            (name): name is string => name !== undefined,
          );

        const account = input.account?.trim().toLowerCase();

        const matches =
          account === undefined
            ? usable
            : usable.filter((connection) =>
                names(connection).some((name) => name.toLowerCase() === account),
              );

        const [connection] = matches;

        if (connection === undefined || matches.length > 1) {
          const choices = usable.map((candidate) => names(candidate).join(" / ")).join(", ");

          throw new Error(
            usable.length === 0
              ? `Connect a ${toolkit.name} account this bot may use first.`
              : account === undefined
                ? `Pick which ${toolkit.name} account to watch: ${choices}.`
                : `No ${toolkit.name} account is called ${input.account}. Accounts: ${choices}.`,
          );
        }

        return {
          type: "app" as const,
          app: toolkit.slug,
          event: event.slug,
          title: event.name,
          connectionId: connection.id,
          config,
          triggerId: null,
        };
      });
    });

  const checkTriggerAccount: ComposioServiceShape["checkTriggerAccount"] = (connectionId, bot) =>
    Effect.flatMap(accounts.list, (records) =>
      withClient("check the trigger's account", async (client, userId) => {
        const connection = (await listConnections(client, userId)).find(
          (candidate) => candidate.id === connectionId,
        );

        if (!connection) return "The app account this routine watches was disconnected.";

        if (connection.status !== "ACTIVE") {
          return "The app account this routine watches needs to be connected again.";
        }

        return composioAccountServesBot(
          records.find((record) => record.connectionId === connectionId),
          bot,
        )
          ? null
          : "The routine's bot may no longer use the app account it watches.";
      }),
    );

  const listTriggers: ComposioServiceShape["listTriggers"] = withClient(
    "list app triggers",
    async (client, userId) => {
      const connectedAccountIds = (await listConnections(client, userId)).map(
        (connection) => connection.id,
      );

      const triggers: ComposioTriggerRecord[] = [];
      let cursor: string | undefined;

      if (connectedAccountIds.length === 0) return triggers;

      do {
        const page = await client.triggers.listActive({
          connectedAccountIds,
          showDisabled: true,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });

        triggers.push(
          ...page.items.map((trigger) => ({
            id: trigger.id,
            connectionId: trigger.connectedAccountId,
            event: trigger.triggerName,
            enabled: trigger.disabledAt === null,
          })),
        );
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      return triggers;
    },
  );

  const createTrigger: ComposioServiceShape["createTrigger"] = (trigger) =>
    withClient("create the app trigger", (client, userId) =>
      client.triggers
        .create(userId, trigger.event, {
          connectedAccountId: trigger.connectionId,
          triggerConfig: trigger.config,
        })
        .then((created) => created.triggerId),
    );

  const setTriggerEnabled: ComposioServiceShape["setTriggerEnabled"] = (triggerId, enabled) =>
    withClient(enabled ? "turn on the app trigger" : "turn off the app trigger", (client) =>
      (enabled ? client.triggers.enable(triggerId) : client.triggers.disable(triggerId)).then(
        () => undefined,
      ),
    );

  const deleteTrigger: ComposioServiceShape["deleteTrigger"] = (triggerId) =>
    withClient("delete the app trigger", (client) =>
      client.triggers.delete(triggerId).then(
        () => undefined,
        (cause: unknown) => {
          if (!isNotFoundError(cause)) throw cause;
        },
      ),
    );

  // Otto: Composio returns the project's signing secret with its subscription, so the
  // secret kept here is the one it signs with since this server last started.
  const subscribeWebhook: ComposioServiceShape["subscribeWebhook"] = (webhookUrl) =>
    Effect.gen(function* () {
      const { secret } = yield* withClient("set up its webhook", (client) =>
        client.triggers.setWebhookSubscription({ webhookUrl }),
      );

      if (!secret) {
        return yield* new ComposioOperationError({
          operation: "set up its webhook",
          message: "Composio did not return the webhook signing secret.",
        });
      }

      yield* secretStore
        .set(WEBHOOK_SECRET, new TextEncoder().encode(secret))
        .pipe(Effect.mapError((cause) => operationError("keep its webhook secret", cause)));
    });

  const verifyWebhook: ComposioServiceShape["verifyWebhook"] = (input) =>
    Effect.gen(function* () {
      const stored = yield* secretStore
        .get(WEBHOOK_SECRET)
        .pipe(Effect.mapError((cause) => operationError("read its webhook secret", cause)));

      if (Option.isNone(stored)) return null;

      return yield* withClient("check a webhook", (client) =>
        client.triggers
          .verifyWebhook({
            id: input.id,
            payload: input.body,
            secret: new TextDecoder().decode(stored.value),
            signature: input.signature,
            timestamp: input.timestamp,
          })
          .then(
            (result): ComposioWebhookDelivery => ({
              triggerId: result.payload.id,
              data: result.payload.payload ?? {},
            }),
            () => null,
          ),
      );
    });

  return {
    prepareTrigger,
    checkTriggerAccount,
    listTriggers,
    createTrigger,
    setTriggerEnabled,
    deleteTrigger,
    subscribeWebhook,
    verifyWebhook,
  };
}
