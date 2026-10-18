import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { inMemoryComposioAccounts } from "./composio-accounts.ts";
import { make } from "./composio-service.ts";
import {
  viewer,
  ben,
  type FakeAccount,
  botOwnedBy,
  makeSecretStore,
  fakeClient,
} from "./test-support/composio-fakes.ts";

describe("ComposioService app triggers", () => {
  const gmailApp = {
    toolkits: [{ slug: "gmail", name: "Gmail", meta: { toolsCount: 1 } }],
    triggerTypes: [
      {
        slug: "GMAIL_NEW_GMAIL_MESSAGE",
        name: "New Gmail message",
        config: { type: "object", required: ["labelIds"] },
      },
    ],
  };

  const account = (id: string, displayName: string): FakeAccount => ({
    id,
    toolkit: { slug: "gmail" },
    status: "ACTIVE",
    state: { val: { displayName } },
  });

  const personal = (connectionId: string, label: string, createdBy = viewer) => ({
    connectionId,
    createdBy: createdBy.personId,
    createdByName: createdBy.displayName,
    label,
    visibility: "user" as const,
    botAccess: {},
  });

  it.effect("picks the event and the one account the person sees and the bot may use", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const accounts = inMemoryComposioAccounts();
      yield* accounts.save(personal("gmail-ana", "Work"));
      yield* accounts.save(personal("gmail-ben", "Ben's", ben));

      const { client } = fakeClient({
        ...gmailApp,
        accounts: [
          account("gmail-ana", "ana@example.com"),
          account("gmail-ben", "ben@example.com"),
        ],
      });

      const service = make(store, accounts, "project-key", () => client);

      const trigger = yield* service.prepareTrigger(
        { app: "Gmail", event: "new gmail message", config: { labelIds: ["INBOX"] } },
        botOwnedBy(viewer.personId),
        viewer.personId,
      );

      expect(trigger).toEqual({
        type: "app",
        app: "gmail",
        event: "GMAIL_NEW_GMAIL_MESSAGE",
        title: "New Gmail message",
        connectionId: "gmail-ana",
        config: { labelIds: ["INBOX"] },
        triggerId: null,
      });
    }),
  );

  it.effect("tells the bot what is missing instead of guessing", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const accounts = inMemoryComposioAccounts();
      yield* accounts.save(personal("gmail-work", "Work"));
      yield* accounts.save(personal("gmail-home", "Home"));

      const { client } = fakeClient({
        ...gmailApp,
        accounts: [account("gmail-work", "ana@work.com"), account("gmail-home", "ana@home.com")],
      });

      const service = make(store, accounts, "project-key", () => client);
      const bot = botOwnedBy(viewer.personId);
      const config = { labelIds: ["INBOX"] };

      const unknownEvent = yield* Effect.flip(
        service.prepareTrigger({ app: "gmail", event: "new star", config }, bot, viewer.personId),
      );

      expect(unknownEvent.message).toContain(
        "Gmail has no event new star. Its events: GMAIL_NEW_GMAIL_MESSAGE (New Gmail message).",
      );

      const noConfig = yield* Effect.flip(
        service.prepareTrigger(
          { app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", account: "Work" },
          bot,
          viewer.personId,
        ),
      );

      expect(noConfig.message).toContain("New Gmail message needs labelIds in config.");

      const twoAccounts = yield* Effect.flip(
        service.prepareTrigger(
          { app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", config },
          bot,
          viewer.personId,
        ),
      );

      expect(twoAccounts.message).toContain(
        "Pick which Gmail account to watch: Work / ana@work.com, Home / ana@home.com.",
      );

      const byAddress = yield* service.prepareTrigger(
        { app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", account: "ana@home.com", config },
        bot,
        viewer.personId,
      );

      expect(byAddress.connectionId).toBe("gmail-home");

      const otherPerson = yield* Effect.flip(
        service.prepareTrigger(
          { app: "gmail", event: "GMAIL_NEW_GMAIL_MESSAGE", config },
          botOwnedBy(ben.personId),
          ben.personId,
        ),
      );

      expect(otherPerson.message).toContain("Connect a Gmail account this bot may use first.");
    }),
  );

  it.effect("creates, switches and deletes triggers on the server's accounts", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const { client } = fakeClient({ ...gmailApp, accounts: [account("gmail-ana", "a@b.c")] });
      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      const triggerId = yield* service.createTrigger({
        type: "app",
        app: "gmail",
        event: "GMAIL_NEW_GMAIL_MESSAGE",
        title: "New Gmail message",
        connectionId: "gmail-ana",
        config: { labelIds: ["INBOX"] },
        triggerId: null,
      });

      expect(client.triggers.create).toHaveBeenCalledWith(
        expect.any(String),
        "GMAIL_NEW_GMAIL_MESSAGE",
        { connectedAccountId: "gmail-ana", triggerConfig: { labelIds: ["INBOX"] } },
      );

      yield* service.setTriggerEnabled(triggerId, false);
      expect(yield* service.listTriggers).toEqual([
        {
          id: triggerId,
          connectionId: "gmail-ana",
          event: "GMAIL_NEW_GMAIL_MESSAGE",
          enabled: false,
        },
      ]);

      yield* service.deleteTrigger(triggerId);
      yield* service.deleteTrigger(triggerId);
      expect(yield* service.listTriggers).toEqual([]);
    }),
  );

  it.effect("checks deliveries with the secret Composio returned for the webhook", () =>
    Effect.gen(function* () {
      const { store, values } = makeSecretStore();
      const { client } = fakeClient(gmailApp);
      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      const body = JSON.stringify({ id: "trigger-1", payload: { subject: "Invoice" } });
      const delivery = { id: "msg_1", timestamp: "1760000000", body };

      expect(yield* service.verifyWebhook({ ...delivery, signature: "v1,whsec-1" })).toBeNull();

      yield* service.subscribeWebhook("https://otto.example.com/webhooks/composio");
      expect(client.triggers.setWebhookSubscription).toHaveBeenCalledWith({
        webhookUrl: "https://otto.example.com/webhooks/composio",
      });
      expect(new TextDecoder().decode(values.get("composio-webhook-secret"))).toBe("whsec-1");

      expect(yield* service.verifyWebhook({ ...delivery, signature: "v1,whsec-1" })).toEqual({
        triggerId: "trigger-1",
        data: { subject: "Invoice" },
      });
      expect(yield* service.verifyWebhook({ ...delivery, signature: "v1,forged" })).toBeNull();
    }),
  );
});
