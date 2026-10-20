import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect, vi } from "vite-plus/test";

import { inMemoryComposioAccounts } from "./composio-accounts.ts";
import { make } from "./composio-service.ts";
import { viewer, makeSecretStore, fakeClient } from "./test-support/composio-fakes.ts";

describe("ComposioService custom auth", () => {
  it.effect("lists custom auth fields and existing configs without storing them", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client } = fakeClient({
        toolkitAuth: {
          composio_managed_auth_schemes: [],
          auth_config_details: [
            {
              mode: "OAUTH2",
              name: "OAuth2",
              fields: {
                auth_config_creation: {
                  required: [
                    { name: "client_id", displayName: "Client ID" },
                    { name: "client_secret", displayName: "Client Secret", is_secret: false },
                  ],
                  optional: [
                    {
                      name: "oauth_redirect_uri",
                      displayName: "Redirect URI",
                      default: "https://backend.composio.dev/api/v1/auth-apps/add",
                    },
                  ],
                },
                connected_account_initiation: {
                  required: [{ name: "subdomain", displayName: "Store subdomain" }],
                },
              },
            },
          ],
        },
        authConfigs: {
          items: [
            {
              id: "ac_shop",
              name: "shopify-jfa41x",
              authScheme: "OAUTH2",
              noOfConnections: 1,
              status: "ENABLED",
            },
            { id: "ac_off", name: "old", authScheme: "OAUTH2", status: "DISABLED" },
          ],
        },
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);
      const setup = yield* service.getAuthSetup("shopify");

      expect(setup.managed).toBe(false);
      expect(setup.configs).toEqual([
        { id: "ac_shop", name: "shopify-jfa41x", scheme: "OAUTH2", connections: 1 },
      ]);
      expect(setup.schemes[0]?.creationFields).toEqual([
        expect.objectContaining({ name: "client_id", secret: false, required: true }),
        expect.objectContaining({ name: "client_secret", secret: true, required: true }),
        expect.objectContaining({
          name: "oauth_redirect_uri",
          required: false,
          default: "https://backend.composio.dev/api/v1/auth-apps/add",
        }),
      ]);
      expect(setup.schemes[0]?.connectionFields).toEqual([
        expect.objectContaining({ name: "subdomain", required: true }),
      ]);
    }),
  );

  it.effect("skips auth configs when Composio hosts the app", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();

      const { client } = fakeClient({
        toolkitAuth: { composioManagedAuthSchemes: ["OAUTH2"], authConfigDetails: [] },
      });

      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(yield* service.getAuthSetup("gmail")).toMatchObject({ managed: true, configs: [] });
      expect(client.authConfigs.list).not.toHaveBeenCalled();
    }),
  );

  it.effect("forwards auth config credentials and does not store them", () =>
    Effect.gen(function* () {
      const { store, values } = makeSecretStore();
      const { client } = fakeClient();
      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(
        yield* service.createAuthConfig({
          toolkitSlug: "shopify",
          scheme: "OAUTH2",
          credentials: { client_id: "id", client_secret: "super-secret", scopes: "  " },
        }),
      ).toEqual({ authConfigId: "ac_created" });
      expect(client.authConfigs.create).toHaveBeenCalledWith("shopify", {
        authScheme: "OAUTH2",
        credentials: { client_id: "id", client_secret: "super-secret" },
      });
      expect(
        [...values.values()].map((bytes) => new TextDecoder().decode(bytes)).join("\n"),
      ).not.toContain("super-secret");
    }),
  );

  it.effect("connects an API key without an authorization URL", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const accounts = inMemoryComposioAccounts();
      const { client } = fakeClient();
      vi.mocked(client.connectedAccounts.initiate).mockResolvedValueOnce({
        id: "ca_klaviyo",
        redirectUrl: null,
        status: "ACTIVE",
      });

      const service = make(
        store,
        accounts,
        "project-key",
        () => client,
        Effect.succeed("org-workspace"),
      );

      expect(
        yield* service.authorize(
          {
            toolkitSlug: "klaviyo",
            alias: "Work",
            authConfigId: "ac_klaviyo",
            authScheme: "API_KEY",
            connection: { generic_api_key: "pk_test" },
          },
          viewer,
        ),
      ).toEqual({ connectionId: "ca_klaviyo" });
      expect(client.sessions.create).not.toHaveBeenCalled();
      expect(client.connectedAccounts.initiate).toHaveBeenCalledWith(
        "org-workspace",
        "ac_klaviyo",
        {
          allowMultiple: true,
          alias: expect.stringContaining("Work"),
          config: {
            authScheme: "API_KEY",
            val: { status: "ACTIVE", generic_api_key: "pk_test" },
          },
        },
      );
      expect(yield* accounts.list).toEqual([
        expect.objectContaining({ connectionId: "ca_klaviyo", label: "Work" }),
      ]);
    }),
  );

  it.effect("links an auth config that has no connection fields", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const { client } = fakeClient();
      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(
        yield* service.authorize(
          { toolkitSlug: "klaviyo", authConfigId: "ac_oauth", authScheme: "OAUTH2" },
          viewer,
        ),
      ).toEqual({
        connectionId: "connection-linked",
        redirectUrl: "https://connect.composio.dev/link",
      });
      expect(client.connectedAccounts.link).toHaveBeenCalled();
      expect(client.connectedAccounts.initiate).not.toHaveBeenCalled();
      expect(client.sessions.create).not.toHaveBeenCalled();
    }),
  );

  it.effect("still requires an authorization URL for a custom OAuth connection", () =>
    Effect.gen(function* () {
      const { store } = makeSecretStore();
      const { client } = fakeClient();
      vi.mocked(client.connectedAccounts.initiate).mockResolvedValueOnce({
        id: "ca_shop",
        redirectUrl: null,
        status: "INITIALIZING",
      });
      const service = make(store, inMemoryComposioAccounts(), "project-key", () => client);

      expect(
        yield* Effect.flip(
          service.authorize(
            {
              toolkitSlug: "shopify",
              authConfigId: "ac_shop",
              authScheme: "OAUTH2",
              connection: { subdomain: "acme" },
            },
            viewer,
          ),
        ),
      ).toMatchObject({
        message:
          "Composio could not start account authorization: Composio did not return an authorization URL.",
      });
      expect(client.sessions.create).not.toHaveBeenCalled();
    }),
  );
});
