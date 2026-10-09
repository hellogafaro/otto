import {
  RiAddLine,
  RiArrowDownSLine,
  RiMoreLine,
  RiOpenaiFill,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import type { InferResponseType } from "hono/client";
import { useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm";
import { QueryState } from "@/components/query-state";
import { read, type workspaceApi } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";
import {
  Group,
  Row,
  SaveState,
  SettingsInput,
  useSettingsAction,
} from "./controls";
import { useDeviceLogin } from "./device-login";

type Subscription = InferResponseType<
  typeof workspaceApi.subscriptions.$get
>["items"][number];
type Visibility = Subscription["visibility"];

/** Two lists by who can use the account: yours alone, or everyone in the workspace. */
export function ModelSettings() {
  const { api, workspaceId, workspace } = useWorkspace();
  const [fresh, setFresh] = useState<string>();
  const accounts = useQuery({
    queryKey: ["workspace", workspaceId, "settings", "subscriptions"],
    queryFn: async () =>
      read(
        await api.subscriptions.$get({
          param: { workspaceId },
          query: { sort: "createdAt", order: "asc" },
        }),
      ),
  });
  if (accounts.isPending || accounts.error)
    return (
      <QueryState
        pending={accounts.isPending}
        error={accounts.error}
        retry={accounts.refetch}
      />
    );
  const canAdd = workspace.role !== "viewer";
  const section = (visibility: Visibility) => ({
    visibility,
    accounts: accounts.data.items.filter(
      (account) => account.visibility === visibility,
    ),
    canAdd,
    fresh,
    onCreated: setFresh,
  });
  return (
    <>
      <Connections
        title="Your connections"
        description="Only you can run agents on these"
        {...section("user")}
      />
      <Connections
        title="Workspace connections"
        description="Everyone in the workspace can run agents on these"
        {...section("workspace")}
      />
    </>
  );
}

function Connections({
  title,
  description,
  visibility,
  accounts,
  canAdd,
  fresh,
  onCreated,
}: {
  title: string;
  description: string;
  visibility: Visibility;
  accounts: Subscription[];
  canAdd: boolean;
  fresh?: string;
  onCreated: (id: string) => void;
}) {
  const { api, workspaceId } = useWorkspace();
  const action = useSettingsAction();
  const add = () =>
    action.perform(async () => {
      const account = await read(
        await api.subscriptions.$post({
          param: { workspaceId },
          json: { title: "Codex", provider: "codex", visibility },
        }),
      );
      onCreated(account.id);
    });
  return (
    <Group title={title} description={description}>
      <Row
        title={
          accounts.length === 1
            ? "1 connection"
            : accounts.length
              ? `${accounts.length} connections`
              : "No connections"
        }
      >
        {canAdd && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add connection"
                  disabled={action.pending}
                />
              }
            >
              <RiAddLine />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={add}>
                  <RiOpenaiFill />
                  Codex
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Row>
      {accounts.map((account) => (
        <Connection
          key={account.id}
          account={account}
          autoConnect={account.id === fresh}
        />
      ))}
    </Group>
  );
}

const states = {
  enabled: "Connected",
  needs_auth: "Sign-in needed",
  disabled: "Disabled",
  disconnected: "Disconnected",
} as const;

function Connection({
  account,
  autoConnect,
}: {
  account: Subscription;
  autoConnect: boolean;
}) {
  const { api, workspaceId, user, workspace, invalidate } = useWorkspace();
  const directory = useDirectory();
  const action = useSettingsAction();
  const confirm = useConfirm();
  const login = useDeviceLogin(account.id);
  const [open, setOpen] = useState(autoConnect);
  // A connection just added signs in at once, in the open row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    if (autoConnect) void login.start();
  }, []);
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
    enabled: open && account.status === "enabled",
    retry: false,
  });
  const patch = async (json: {
    title?: string;
    visibility?: Visibility;
    status?: "disabled" | "needs_auth";
  }) => {
    await read(
      await api.subscriptions[":id"].$patch({
        param: { workspaceId, id: account.id },
        json,
      }),
    );
  };
  const shared = account.visibility === "workspace";
  const by =
    account.createdBy === user.id
      ? ""
      : directory.actorOf(account.createdBy).name;
  return (
    <>
      <Row
        title={account.title}
        description={[states[account.status], by && `Added by ${by}`]
          .filter(Boolean)
          .join(" · ")}
        media={<RiOpenaiFill className="size-5" />}
      >
        {account.status === "needs_auth" && (
          <Badge variant="outline">Reconnect needed</Badge>
        )}
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${account.title}`}
                  disabled={busy}
                />
              }
            >
              <RiMoreLine />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                {account.status === "disabled" ? (
                  <DropdownMenuItem
                    onClick={async () => {
                      const ok = await action.perform(() =>
                        patch({ status: "needs_auth" }),
                      );
                      if (ok) {
                        setOpen(true);
                        void login.start();
                      }
                    }}
                  >
                    Enable
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => {
                      setOpen(true);
                      void login.start();
                    }}
                  >
                    Reconnect
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={async () => {
                    const yes = await confirm({
                      title: shared ? "Make private?" : "Share with workspace?",
                      description: shared
                        ? "Other members and their active runs lose access to this account."
                        : "Everyone in the workspace can run agents on this account, without seeing its sign-in.",
                      action: shared ? "Make private" : "Share",
                    });
                    if (yes)
                      await action.perform(() =>
                        patch({ visibility: shared ? "user" : "workspace" }),
                      );
                  }}
                >
                  {shared ? "Make private" : "Share with workspace"}
                </DropdownMenuItem>
                {account.status !== "disabled" && (
                  <DropdownMenuItem
                    onClick={async () => {
                      const yes = await confirm({
                        title: `Disable ${account.title}?`,
                        description:
                          "New runs are blocked and active runs lose this account on their next model request.",
                        action: "Disable",
                        destructive: true,
                      });
                      if (yes)
                        await action.perform(() =>
                          patch({ status: "disabled" }),
                        );
                    }}
                  >
                    Disable
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    const yes = await confirm({
                      title: `Disconnect ${account.title}?`,
                      description:
                        "Its stored sign-in is removed for good. Agents that use it can't run until you pick another account.",
                      action: "Disconnect",
                      destructive: true,
                    });
                    if (yes)
                      await action.perform(
                        async () =>
                          read(
                            await api.subscriptions[":id"].disconnect.$post({
                              param: { workspaceId, id: account.id },
                            }),
                          ),
                        `${account.title} disconnected`,
                      );
                  }}
                >
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${open ? "Collapse" : "Expand"} ${account.title}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <RiArrowDownSLine className={open ? "rotate-180" : undefined} />
        </Button>
      </Row>
      {open && (
        <>
          {editable && (
            <Row title="Name">
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
          )}
          {(action.pending || action.error) && (
            <Row title="Update">
              <SaveState {...action} />
            </Row>
          )}
          {(login.pending || login.status || login.error) && (
            <Row title="Sign-in" description={login.status}>
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
                  <Button
                    variant="outline"
                    size="compact"
                    onClick={login.cancel}
                  >
                    Cancel sign-in
                  </Button>
                )}
              </div>
            </Row>
          )}
          {account.status === "enabled" && (
            <>
              <QueryState
                pending={models.isPending}
                error={models.error}
                retry={models.refetch}
              />
              {models.data && !models.error && (
                <Row
                  title="Models"
                  description="What this account offers, as the server recognizes it"
                >
                  <div className="flex flex-col items-end gap-1 text-sm">
                    {models.data.items.length ? (
                      models.data.items.map((model) => (
                        <span key={model.id}>{model.id}</span>
                      ))
                    ) : (
                      <span>No models</span>
                    )}
                  </div>
                </Row>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
