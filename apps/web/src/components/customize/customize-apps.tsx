import type {
  ComposioConnection,
  ComposioToolkit,
  ComposioVisibility,
  EnvironmentId,
  LibraryVisibility,
} from "@otto/contracts";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiPuzzleLine,
  RiSearchLine,
  RiToolsLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Predicate } from "effect";
import { type ReactNode, useDeferredValue, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { openSettings } from "../../settings-dialog-store";
import { LibraryVisibilitySelect } from "../library/library-actions";
import { SettingsCard } from "../settings/settings-layout";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldError } from "../ui/field";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Spinner } from "../ui/spinner";
import { SkeletonSettingsSections } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer } from "../settings/settings-layout";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PageTitle } from "../workspace-page-container";
import { WorkEmpty } from "../work/work-pages";
import { CustomizeGroup, CustomizeItem, CustomizeRow, LogoTile } from "./customize-group";
import { DetailHeader } from "./customize-detail";
import { AppLogo, ConnectionStatus, useComposio } from "./customize-integrations";

/** Shown instead of the catalog until someone adds a Composio key. */
function NotConfigured({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t } = useI18n();

  return (
    <WorkEmpty
      icon={<RiPuzzleLine />}
      title={t("Connect apps with Composio")}
      description={t("Add a Composio key in Settings to connect apps like Slack and Gmail.")}
      action={
        <Button variant="outline" onClick={() => openSettings("integrations", null, environmentId)}>
          {t("Open settings")}
        </Button>
      }
    />
  );
}

function AppsList({
  environmentId,
  query,
  visibility,
}: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly visibility: ComposioVisibility;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [search, setSearch] = useState(query);
  const deferredSearch = useDeferredValue(search.trim());

  const toolkits = useEnvironmentQuery(
    serverEnvironment.composioToolkits({
      environmentId,
      input: { ...(deferredSearch ? { query: deferredSearch } : {}), limit: 50 },
    }),
  );

  const apps = toolkits.data ?? [];

  return (
    <>
      <InputGroup>
        <InputGroupAddon>
          <RiSearchLine aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          autoFocus
          type="search"
          aria-label={t("Search apps")}
          placeholder={t("Search apps")}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </InputGroup>
      {toolkits.error ? (
        <p className="text-13px text-destructive-foreground">
          {t("Could not reach Composio: {error}", { error: String(toolkits.error) })}
        </p>
      ) : toolkits.data === undefined ? (
        <SkeletonSettingsSections label={t("Loading settings")} sections={[6]} headings={false} />
      ) : apps.length === 0 ? (
        <p className="text-13px text-muted-foreground">
          {deferredSearch
            ? t("No apps match “{query}”.", { query: deferredSearch })
            : t("Composio lists no apps for this key.")}
        </p>
      ) : (
        <SettingsCard>
          {apps.map((toolkit) => (
            <CustomizeRow
              key={toolkit.slug}
              logo={<AppLogo src={toolkit.logoUrl} name={toolkit.name} className="size-4" />}
              name={toolkit.name}
              detail={toolkit.description}
              onOpen={() =>
                void navigate({
                  to: "/settings/integrations/apps/$slug",
                  params: { slug: toolkit.slug },
                  search: { visibility },
                })
              }
            />
          ))}
        </SettingsCard>
      )}
    </>
  );
}

function AppsBody({
  environmentId,
  query,
  visibility,
}: {
  readonly environmentId: EnvironmentId;
  readonly query: string;
  readonly visibility: ComposioVisibility;
}) {
  const composio = useComposio(environmentId);

  if (!composio.status.data) return null;

  return composio.status.data.configured ? (
    <AppsList environmentId={environmentId} query={query} visibility={visibility} />
  ) : (
    <NotConfigured environmentId={environmentId} />
  );
}

/**
 * Otto: The app catalog at /settings/integrations/apps: Composio's apps, most used first, on the `content`
 * column under a 32px title and a search field, one card of rows (logo, name, the app's own
 * description, chevron). A row opens that app's page. `?visibility=` carries the group a new
 * account joins, from the Customize group whose plus opened the catalog.
 */
export function CustomizeAppsPage({
  query,
  visibility,
}: {
  readonly query: string;
  readonly visibility: ComposioVisibility;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();

  return (
    <SettingsPageContainer className="gap-6">
      <PageTitle>{t("Apps")}</PageTitle>
      {environmentId ? (
        <AppsBody environmentId={environmentId} query={query} visibility={visibility} />
      ) : null}
    </SettingsPageContainer>
  );
}

/** Starts a sign-in for one app, with its required label and the group the account joins. */
function ConnectDialog({
  environmentId,
  toolkit,
  visibility,
  labels,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly toolkit: ComposioToolkit;
  readonly visibility: ComposioVisibility;
  /** Labels already used for this app; Composio needs each one to be unique. */
  readonly labels: readonly string[];
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const composio = useComposio(environmentId);
  const [alias, setAlias] = useState("");
  const [owner, setOwner] = useState<LibraryVisibility>(visibility);
  const [connecting, setConnecting] = useState(false);

  const taken = labels.some((label) => label.toLowerCase() === alias.trim().toLowerCase());

  const connect = async () => {
    if (!alias.trim() || taken) return;
    setConnecting(true);

    const result = await composio.authorize({
      environmentId,
      input: { toolkitSlug: toolkit.slug, visibility: owner, alias: alias.trim() },
    });

    setConnecting(false);

    if (Predicate.isTagged(result, "Failure")) {
      composio.failed(t("Could not connect {name}", { name: toolkit.name }), result);

      return;
    }

    const url = new URL(result.value.redirectUrl);

    if (url.protocol !== "https:") {
      toastManager.add({
        type: "error",
        title: t("Could not connect {name}", { name: toolkit.name }),
        description: t("Composio returned a sign-in link that does not use HTTPS."),
      });

      return;
    }

    composio.status.refresh();
    onClose();
    void ensureLocalApi()
      .shell.openExternal(url.toString())
      .catch(() =>
        toastManager.add({
          type: "error",
          title: t("Could not open {name} sign-in", { name: toolkit.name }),
        }),
      );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Connect {name}", { name: toolkit.name })}</DialogTitle>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <DialogPanel>
            <Field>
              <div className="flex w-full items-center gap-2">
                <Input
                  autoFocus
                  aria-label={t("Label")}
                  value={alias}
                  placeholder={t("Label, like Work or Personal")}
                  onChange={(event) => setAlias(event.currentTarget.value)}
                />
                <div className="shrink-0">
                  <LibraryVisibilitySelect value={owner} editable onChange={setOwner} />
                </div>
              </div>
              {taken ? (
                <FieldError match>
                  {t("You already have an account called {label}.", { label: alias.trim() })}
                </FieldError>
              ) : null}
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={connecting || !alias.trim() || taken}>
              {connecting ? <Spinner /> : null}
              {t("Connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * One connected account, managed in place: its label (or the account it signed in as), its status,
 * who it serves, and a trash glyph to disconnect it. There is no separate account page.
 */
function AccountRow({
  environmentId,
  connection,
  logo,
}: {
  readonly environmentId: EnvironmentId;
  readonly connection: ComposioConnection;
  readonly logo: ReactNode;
}) {
  const { t } = useI18n();
  const composio = useComposio(environmentId);
  const name = connection.alias ?? connection.accountName ?? connection.toolkitName ?? "";

  const setVisibility = async (visibility: LibraryVisibility) => {
    const result = await composio.update({
      environmentId,
      input: { connectionId: connection.id, visibility },
    });

    if (!composio.failed(t("Could not update {name}", { name }), result)) composio.status.refresh();
  };

  const disconnect = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      t("Disconnect {name}? Bots stop using this account.", { name }),
      { variant: "destructive" },
    );

    if (!confirmed) return;

    const result = await composio.disconnect({
      environmentId,
      input: { connectionId: connection.id },
    });

    if (!composio.failed(t("Could not disconnect {name}", { name }), result)) {
      composio.status.refresh();
    }
  };

  return (
    <div data-settings-row="" className="flex items-center gap-3 px-4 py-3">
      <LogoTile>{logo}</LogoTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13px font-medium text-foreground">{name}</span>
        {connection.alias && connection.accountName ? (
          <span className="block truncate text-xs text-muted-foreground">
            {connection.accountName}
          </span>
        ) : connection.ownerName ? (
          <span className="block truncate text-xs text-muted-foreground">
            {t("Added by {name}", { name: connection.ownerName })}
          </span>
        ) : null}
      </span>
      <ConnectionStatus connection={connection} />
      <LibraryVisibilitySelect
        value={connection.visibility}
        editable={connection.manageable}
        onChange={(visibility) => void setVisibility(visibility)}
      />
      {connection.manageable ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost-muted"
                aria-label={t("Disconnect")}
                onClick={() => void disconnect()}
              >
                <RiDeleteBinLine aria-hidden className="size-4" />
              </Button>
            }
          />
          <TooltipPopup side="bottom">{t("Disconnect")}</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}

function AppBody({
  environmentId,
  slug,
  visibility,
}: {
  readonly environmentId: EnvironmentId;
  readonly slug: string;
  readonly visibility: ComposioVisibility;
}) {
  const { t } = useI18n();
  const composio = useComposio(environmentId);
  const [connecting, setConnecting] = useState(false);

  // Sign-in finishes in the browser, so pick up the new account on return.
  const refreshStatus = composio.status.refresh;

  useEffect(() => {
    window.addEventListener("focus", refreshStatus);

    return () => window.removeEventListener("focus", refreshStatus);
  }, [refreshStatus]);

  const detail = useEnvironmentQuery(
    serverEnvironment.composioToolkit({ environmentId, input: { slug } }),
  );

  if (detail.error) {
    return (
      <WorkEmpty
        icon={<RiPuzzleLine />}
        title={t("Not found")}
        description={t("Could not reach Composio: {error}", { error: String(detail.error) })}
      />
    );
  }

  if (!detail.data)
    return <SkeletonSettingsSections label={t("Loading settings")} sections={[2, 4]} />;
  const { toolkit, tools } = detail.data;

  const connections = (composio.status.data?.connections ?? []).filter(
    (connection) => connection.toolkitSlug === slug,
  );

  return (
    <>
      <DetailHeader
        logo={<AppLogo src={toolkit.logoUrl} name={toolkit.name} className="size-5" />}
        title={toolkit.name}
        description={toolkit.description ?? null}
      />
      <CustomizeGroup
        title={t("Accounts")}
        count={connections.length}
        empty={
          connections.length === 0
            ? { icon: <RiPuzzleLine />, description: t("No accounts") }
            : null
        }
        action={
          <Button size="sm" variant="outline" onClick={() => setConnecting(true)}>
            <RiAddLine aria-hidden />
            {t("Connect")}
          </Button>
        }
      >
        {connections.map((connection) => (
          <AccountRow
            key={connection.id}
            environmentId={environmentId}
            connection={connection}
            logo={<AppLogo src={toolkit.logoUrl} name={toolkit.name} className="size-4" />}
          />
        ))}
      </CustomizeGroup>
      <CustomizeGroup
        title={t("Tools")}
        count={tools.length}
        empty={tools.length === 0 ? { icon: <RiToolsLine />, description: t("No tools") } : null}
      >
        {tools.map((tool) => (
          <CustomizeItem
            key={tool.slug}
            icon={<RiToolsLine aria-hidden className="size-4" />}
            name={tool.name}
            description={tool.description}
          />
        ))}
      </CustomizeGroup>
      {connecting ? (
        <ConnectDialog
          environmentId={environmentId}
          toolkit={toolkit}
          visibility={visibility}
          labels={connections.flatMap((connection) => connection.alias ?? [])}
          onClose={() => setConnecting(false)}
        />
      ) : null}
    </>
  );
}

/**
 * Otto: One app at /settings/integrations/apps/$slug, on the `narrow` column: the 40px logo tile beside
 * the 22px name and the app's description, then its Accounts card (count, an outline Connect
 * button, one row per account managed in place: label or signed-in account, status pill, owner
 * select and a trash glyph; there is no account page or dialog), then the
 * tools it gives bots, each in a card row. Connect opens a small dialog: one label field (required,
 * unique per app) with the owner select to its right.
 */
export function CustomizeAppPage({
  slug,
  visibility,
}: {
  readonly slug: string;
  readonly visibility: ComposioVisibility;
}) {
  const environmentId = usePrimaryEnvironmentId();

  return (
    <SettingsPageContainer>
      {environmentId ? (
        <AppBody environmentId={environmentId} slug={slug} visibility={visibility} />
      ) : null}
    </SettingsPageContainer>
  );
}
