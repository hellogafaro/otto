import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import type { InferResponseType } from "hono/client";
import { useId, useState } from "react";
import { QueryState } from "@/components/query-state";
import {
  Choice,
  Group,
  Row,
  SaveState,
  useSettingsAction,
  useSettingsCreation,
} from "@/features/settings/controls";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Subscription = InferResponseType<
  typeof workspaceApi.subscriptions.$get
>["items"][number];
type Provider = "openai" | "anthropic" | "openai-compatible";

export function NativeProviderSettings() {
  const { api, workspaceId, workspace } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [keyAccount, setKeyAccount] = useState<Subscription | null>(null);
  const [editingAccount, setEditingAccount] = useState<Subscription | null>(
    null,
  );
  const accounts = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "settings", "subscriptions"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.subscriptions.$get({
          param: { workspaceId },
          query: { sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const items = accounts.data?.pages.flatMap((page) => page.items) ?? [];
  const writer = workspace.role !== "viewer";
  return (
    <>
      <QueryState
        pending={accounts.isPending}
        error={accounts.error}
        retry={accounts.refetch}
      />
      {!accounts.isPending && !accounts.error && (
        <>
          {!items.length ? (
            <Group
              title="No providers"
              description="Add an API-key provider to run agents with your chosen model."
            >
              {writer && (
                <Row title="API providers">
                  <Button onClick={() => setAdding(true)}>Add provider</Button>
                </Row>
              )}
            </Group>
          ) : (
            <>
              {(["user", "workspace"] as const)
                .filter((visibility) =>
                  items.some((account) => account.visibility === visibility),
                )
                .map((visibility) => (
                  <Group
                    key={visibility}
                    title={
                      visibility === "user"
                        ? "Your providers"
                        : "Workspace providers"
                    }
                    description={
                      visibility === "user"
                        ? "Only you can use these providers."
                        : "Eligible workspace members can run agents without seeing the API key."
                    }
                  >
                    {items
                      .filter((account) => account.visibility === visibility)
                      .map((account) => (
                        <ProviderRow
                          key={account.id}
                          account={account}
                          onKey={() => setKeyAccount(account)}
                          onEdit={() => setEditingAccount(account)}
                        />
                      ))}
                  </Group>
                ))}
              {writer && (
                <Button
                  className="self-start"
                  variant="outline"
                  onClick={() => setAdding(true)}
                >
                  Add provider
                </Button>
              )}
            </>
          )}
          {accounts.hasNextPage && (
            <Button
              variant="ghost"
              disabled={accounts.isFetchingNextPage}
              onClick={() => accounts.fetchNextPage()}
            >
              More providers
            </Button>
          )}
        </>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add provider</DialogTitle>
          </DialogHeader>
          {adding && (
            <ProviderForm
              onSaved={(account) => {
                setAdding(false);
                setKeyAccount(account);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!keyAccount}
        onOpenChange={(open) => {
          if (!open) setKeyAccount(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set API key</DialogTitle>
          </DialogHeader>
          {keyAccount && (
            <ProviderKey
              key={keyAccount.id}
              account={keyAccount}
              onSaved={() => setKeyAccount(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editingAccount}
        onOpenChange={(open) => {
          if (!open) setEditingAccount(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit provider</DialogTitle>
          </DialogHeader>
          {editingAccount && (
            <ProviderDetails
              key={editingAccount.id}
              account={editingAccount}
              onSaved={() => setEditingAccount(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProviderRow({
  account,
  onKey,
  onEdit,
}: {
  account: Subscription;
  onKey: () => void;
  onEdit: () => void;
}) {
  const { api, workspaceId, user, workspace } = useWorkspace();
  const action = useSettingsAction();
  const owner = account.createdBy === user.id && workspace.role !== "viewer";
  const historical = account.provider === "codex";
  return (
    <>
      <Row
        title={account.title}
        description={
          historical
            ? "Historical Codex connection · unsupported"
            : `${account.provider} · ${account.protocol} · ${account.status === "enabled" ? "Key saved" : account.status === "needs_auth" ? "API key needed" : account.status}`
        }
      >
        {owner && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="compact"
              disabled={action.pending}
              onClick={onEdit}
            >
              Edit
            </Button>
            {!historical && (
              <Button
                variant="outline"
                size="compact"
                disabled={action.pending}
                onClick={onKey}
              >
                {account.status === "enabled" ? "Replace key" : "Set key"}
              </Button>
            )}
            {account.status === "enabled" && (
              <Button
                variant="ghost"
                size="compact"
                disabled={action.pending}
                onClick={() =>
                  action.perform(async () =>
                    read(
                      await api.subscriptions[":id"].$patch({
                        param: { workspaceId, id: account.id },
                        json: { status: "disabled" },
                      }),
                    ),
                  )
                }
              >
                Disable
              </Button>
            )}
            <Button
              variant="ghost"
              size="compact"
              disabled={action.pending}
              onClick={() =>
                action.perform(async () =>
                  read(
                    await api.subscriptions[":id"].disconnect.$post({
                      param: { workspaceId, id: account.id },
                    }),
                  ),
                )
              }
            >
              Disconnect
            </Button>
          </div>
        )}
      </Row>
      <SaveState pending={action.pending} error={action.error} />
    </>
  );
}

function ProviderDetails({
  account,
  onSaved,
}: {
  account: Subscription;
  onSaved: () => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const action = useSettingsAction();
  const titleId = useId();
  const [title, setTitle] = useState(account.title);
  const [visibility, setVisibility] = useState(account.visibility);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void action.perform(async () => {
          await read(
            await api.subscriptions[":id"].$patch({
              param: { workspaceId, id: account.id },
              json: { title, visibility },
            }),
          );
          onSaved();
        });
      }}
    >
      <fieldset disabled={action.pending} className="flex flex-col gap-4">
        <label htmlFor={titleId} className="flex flex-col gap-2">
          Title
          <Input
            id={titleId}
            value={title}
            required
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <Row title="Who can use it">
          <Choice
            label="Who can use it"
            value={visibility}
            options={{ user: "Only you", workspace: "Workspace" }}
            onChange={setVisibility}
          />
        </Row>
        <Row title="Provider">{account.provider}</Row>
        {account.baseUrl && <Row title="Endpoint">{account.baseUrl}</Row>}
        {account.models.length > 0 && (
          <Row title="Model IDs">{account.models.join(", ")}</Row>
        )}
        <p>
          Provider, endpoint, protocol and configured models stay fixed. Add a
          new provider configuration to change them.
        </p>
        <SaveState pending={action.pending} error={action.error} />
        <Button type="submit">
          {action.pending ? "Saving" : "Save provider"}
        </Button>
      </fieldset>
    </form>
  );
}

function ProviderForm({
  onSaved,
}: {
  onSaved: (account: Subscription) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const action = useSettingsCreation();
  const formId = useId();
  const [provider, setProvider] = useState<Provider>("openai");
  const [protocol, setProtocol] = useState<"responses" | "chat-completions">(
    "responses",
  );
  const [title, setTitle] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState("");
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void action.perform(async () => {
          const account = await action.create(() =>
            api.subscriptions.$post({
              param: { workspaceId },
              json: {
                title,
                provider,
                protocol: provider === "anthropic" ? "anthropic" : protocol,
                baseUrl: provider === "openai-compatible" ? baseUrl : undefined,
                models: models
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
                visibility,
              },
            }),
          );
          onSaved(account);
        });
      }}
    >
      <fieldset
        disabled={action.pending || action.blocked}
        className="flex flex-col gap-4"
      >
        <Row title="Provider">
          <Choice
            label="Provider"
            value={provider}
            options={{
              openai: "OpenAI",
              anthropic: "Anthropic",
              "openai-compatible": "OpenAI-compatible",
            }}
            onChange={setProvider}
          />
        </Row>
        <label htmlFor={`${formId}-title`} className="flex flex-col gap-2">
          Title
          <Input
            id={`${formId}-title`}
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {provider !== "anthropic" && (
          <Row title="Endpoint protocol">
            <Choice
              label="Endpoint protocol"
              value={protocol}
              options={{
                responses: "Responses",
                "chat-completions": "Chat Completions",
              }}
              onChange={setProtocol}
            />
          </Row>
        )}
        {provider === "openai-compatible" && (
          <label htmlFor={`${formId}-url`} className="flex flex-col gap-2">
            Base URL
            <Input
              id={`${formId}-url`}
              type="url"
              value={baseUrl}
              required
              placeholder="https://api.provider.com/v1"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
        )}
        <label htmlFor={`${formId}-models`} className="flex flex-col gap-2">
          Model IDs
          <Input
            id={`${formId}-models`}
            value={models}
            required
            placeholder="Comma-separated model IDs"
            onChange={(event) => setModels(event.target.value)}
          />
        </label>
        <Row title="Who can use it">
          <Choice
            label="Who can use it"
            value={visibility}
            options={{ user: "Only you", workspace: "Workspace" }}
            onChange={setVisibility}
          />
        </Row>
        <p>
          Choose exact model IDs from your provider. Otto does not switch
          providers, protocols or models automatically.
        </p>
        <SaveState pending={action.pending} error={action.error} />
        <Button type="submit">
          {action.pending ? "Saving" : "Continue to API key"}
        </Button>
      </fieldset>
    </form>
  );
}

function ProviderKey({
  account,
  onSaved,
}: {
  account: Subscription;
  onSaved: () => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const action = useSettingsAction();
  const keyId = useId();
  const [apiKey, setApiKey] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = apiKey;
        setApiKey("");
        void action.perform(async () => {
          await read(
            await api.subscriptions[":id"]["api-key"].$put({
              param: { workspaceId, id: account.id },
              json: { apiKey: value },
            }),
          );
          onSaved();
        });
      }}
    >
      <fieldset disabled={action.pending} className="flex flex-col gap-4">
        <p>
          {account.title} · {account.baseUrl}
        </p>
        <label htmlFor={keyId} className="flex flex-col gap-2">
          API key
          <Input
            id={keyId}
            type="password"
            autoComplete="new-password"
            value={apiKey}
            maxLength={8192}
            required
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <p>
          The key is encrypted on the server and is never returned. Saving a
          replacement invalidates previously accepted runs. A saved key does not
          verify provider access or billing.
        </p>
        <SaveState pending={action.pending} error={action.error} />
        <Button type="submit" disabled={!apiKey}>
          {action.pending ? "Saving" : "Save API key"}
        </Button>
      </fieldset>
    </form>
  );
}
