import { RiOpenaiFill } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { useConfirm } from "@/components/confirm";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import {
  Choice,
  Group,
  Row,
  SaveState,
  SettingsDialog,
  SettingsField,
  SettingsInput,
  SettingsListControls,
  SettingsPaging,
  useSettingsAction,
  useSettingsList,
} from "./controls";
import { useDeviceLogin } from "./device-login";

type Subscription = InferResponseType<
  typeof workspaceApi.subscriptions.$get
>["items"][number];
const sorts = { title: "Name", createdAt: "Created", updatedAt: "Updated" };
const visibilityOptions = { user: "Only you", workspace: "Workspace" };
export function ModelSettings() {
  const { api, workspaceId } = useWorkspace();
  const list = useSettingsList(sorts, "title");
  const id = list.params.get("account") || undefined;
  const selected = useQuery({
    queryKey: ["workspace", workspaceId, "settings", "subscription", id],
    queryFn: async () => {
      if (!id) throw new Error("Select an account.");
      return read(
        await api.subscriptions[":id"].$get({ param: { workspaceId, id } }),
      );
    },
    enabled: Boolean(id),
  });
  const status = (["needs_auth", "enabled", "disabled"] as const).find(
    (value) => value === list.params.get("status"),
  );
  const visibility = (["user", "workspace"] as const).find(
    (value) => value === list.params.get("visibility"),
  );
  const accounts = useQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "settings",
      "subscriptions",
      list.request,
      status,
      visibility,
    ],
    enabled: !id,
    queryFn: async () =>
      read(
        await api.subscriptions.$get({
          param: { workspaceId },
          query: { ...list.request, status, visibility },
        }),
      ),
  });
  if (id)
    return (
      <>
        <Button
          className="self-start"
          variant="outline"
          size="compact"
          onClick={() => list.update({ account: undefined })}
        >
          All accounts
        </Button>
        <QueryState
          pending={selected.isPending}
          error={selected.error}
          retry={selected.refetch}
        />
        {selected.data && !selected.error && (
          <Group title="Selected account">
            <SubscriptionCard key={selected.data.id} account={selected.data} />
          </Group>
        )}
      </>
    );
  return (
    <>
      <SettingsListControls list={list} sorts={sorts}>
        <Choice
          label="Account status"
          value={status ?? "all"}
          options={{
            all: "All statuses",
            needs_auth: "Needs authentication",
            enabled: "Enabled",
            disabled: "Disabled",
          }}
          onChange={(status) =>
            list.update({ status: status === "all" ? undefined : status })
          }
        />
        <Choice
          label="Account visibility"
          value={visibility ?? "all"}
          options={{ all: "All accounts", ...visibilityOptions }}
          onChange={(visibility) =>
            list.update({
              visibility: visibility === "all" ? undefined : visibility,
            })
          }
        />
      </SettingsListControls>
      <QueryState
        pending={accounts.isPending}
        error={accounts.error}
        retry={accounts.refetch}
      />
      {accounts.data && !accounts.error && (
        <>
          <Group
            title="Accounts"
            description="Each run uses its selected account and model. Only Codex is supported."
          >
            {!accounts.data.items.length && (
              <Row
                title="No accounts match"
                description="Create an account or change the filters."
              />
            )}
            {accounts.data.items.map((account) => (
              <SubscriptionCard key={account.id} account={account} />
            ))}
          </Group>
          <SettingsPaging
            next={accounts.data.next}
            after={list.after}
            change={(after) => list.update({ after })}
          />
        </>
      )}
      <Group title="Default">
        <Row
          title="Model"
          description="Choose an authorized account and one of its actual models in each agent's settings. Workspace default models are not available."
        />
      </Group>
    </>
  );
}
export function NewSubscription({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  const action = useSettingsAction();
  return (
    <SettingsDialog
      title="New account"
      description="Create a Codex account, then authenticate it with the device flow. Sharing uses your account's billing channel."
      open={open}
      onOpenChange={onOpenChange}
      pending={action.pending}
      error={action.error}
      onSubmit={async () => {
        if (
          await action.perform(async () => {
            const account = await read(
              await api.subscriptions.$post({
                param: { workspaceId },
                json: { title: title.trim(), provider: "codex", visibility },
              }),
            );
            router.history.push(
              `/settings/models?account=${encodeURIComponent(account.id)}`,
            );
          }, "Account created")
        ) {
          setTitle("");
          setVisibility("user");
          onOpenChange(false);
        }
      }}
    >
      <SettingsField
        label="Name"
        required
        maxLength={200}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Field>
        <FieldLabel>Who can use it</FieldLabel>
        <Choice
          label="Account visibility"
          value={visibility}
          options={visibilityOptions}
          onChange={setVisibility}
        />
      </Field>
    </SettingsDialog>
  );
}
function SubscriptionCard({ account }: { account: Subscription }) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const login = useDeviceLogin(account.id);
  const [showModels, setShowModels] = useState(false);
  const editable = account.createdBy === user.id && workspace.role !== "viewer";
  const busy = action.pending || login.pending;
  const models = useQuery({
    queryKey: ["workspace", workspaceId, "subscriptions", account.id, "models"],
    queryFn: async () =>
      read(
        await api.subscriptions[":id"].models.$get({
          param: { workspaceId, id: account.id },
        }),
      ),
    enabled: showModels && account.status === "enabled",
    retry: false,
  });
  const patch = async (json: {
    title?: string;
    visibility?: "user" | "workspace";
    status?: "disabled" | "needs_auth";
  }) => {
    await read(
      await api.subscriptions[":id"].$patch({
        param: { workspaceId, id: account.id },
        json,
      }),
    );
  };
  return (
    <>
      <Row
        title={account.title}
        description={`Codex · ${account.status === "enabled" ? "Enabled" : account.status === "disabled" ? "Disabled" : "Needs authentication"} · ${account.visibility === "workspace" ? "Workspace" : "Only creator"}`}
        media={<RiOpenaiFill className="size-5" />}
      >
        <div className="flex flex-wrap gap-2">
          {editable && (
            <>
              {account.status === "disabled" ? (
                <Button
                  variant="outline"
                  size="compact"
                  disabled={busy}
                  onClick={() =>
                    action.perform(
                      () => patch({ status: "needs_auth" }),
                      "Authentication required",
                    )
                  }
                >
                  Enable login
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="compact"
                  disabled={busy}
                  onClick={() => login.start()}
                >
                  {account.status === "enabled"
                    ? "Reauthenticate"
                    : "Authenticate"}
                </Button>
              )}
              {account.status !== "disabled" && (
                <Button
                  variant="outline"
                  size="compact"
                  disabled={busy}
                  onClick={async () => {
                    const yes = await confirm({
                      title: `Disable ${account.title}?`,
                      description:
                        "New runs will be blocked and active runs lose account access on their next model request.",
                      action: "Disable",
                      destructive: true,
                    });
                    if (yes)
                      await action.perform(
                        () => patch({ status: "disabled" }),
                        "Account disabled",
                      );
                  }}
                >
                  Disable
                </Button>
              )}
            </>
          )}
          <Button
            variant="outline"
            size="compact"
            disabled={account.status !== "enabled"}
            onClick={() => setShowModels((value) => !value)}
          >
            {showModels ? "Hide models" : "Models"}
          </Button>
        </div>
      </Row>
      {editable && (
        <>
          <Row title={`${account.title} name`}>
            <SettingsInput
              label={`${account.title} name`}
              initial={account.title}
              disabled={busy}
              save={async (title) => {
                await patch({ title: title.trim() });
                await invalidate();
              }}
            />
          </Row>
          <Row
            title="Who can use this account"
            description="Workspace members use your credentials without seeing them or your private context."
          >
            <Choice
              label={`${account.title} visibility`}
              value={account.visibility}
              options={visibilityOptions}
              disabled={busy}
              onChange={async (visibility) => {
                if (visibility === account.visibility) return;
                const yes = await confirm({
                  title:
                    visibility === "workspace"
                      ? "Share account?"
                      : "Stop sharing account?",
                  description:
                    visibility === "workspace"
                      ? "Current workspace members will be able to run agents using this exact account."
                      : "Other members and their active runs will lose access immediately.",
                  action: visibility === "workspace" ? "Share" : "Stop sharing",
                });
                if (yes)
                  await action.perform(
                    () => patch({ visibility }),
                    "Account visibility saved",
                  );
              }}
            />
          </Row>
        </>
      )}
      {(action.pending || action.error) && (
        <Row title="Account update">
          <SaveState {...action} />
        </Row>
      )}
      {(login.pending || login.status || login.error) && (
        <Row title="Authentication" description={login.status}>
          <div className="flex flex-col items-start gap-2">
            {login.device && (
              <>
                <a
                  href={login.device.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open verification page
                </a>
                <span>
                  Device code: <code>{login.device.userCode}</code>
                </span>
                <span className="text-xs text-muted-foreground">
                  Expires at{" "}
                  {new Date(login.device.expiresAt).toLocaleTimeString()}
                </span>
              </>
            )}
            <SaveState
              error={login.error}
              retry={!login.pending && editable ? login.start : undefined}
            />
            {login.pending && (
              <Button variant="outline" size="compact" onClick={login.cancel}>
                Cancel authentication
              </Button>
            )}
          </div>
        </Row>
      )}
      {showModels && account.status === "enabled" && (
        <>
          <QueryState
            pending={models.isPending}
            error={models.error}
            retry={models.refetch}
          />
          {models.data && !models.error && (
            <Row
              title="Available models"
              description="Offered by this exact account and recognized by the server."
            >
              <div className="flex flex-col gap-1">
                {models.data.items.length ? (
                  models.data.items.map((model) => (
                    <span key={model.id}>{model.id}</span>
                  ))
                ) : (
                  <span>No models available</span>
                )}
              </div>
            </Row>
          )}
        </>
      )}
    </>
  );
}
