import type {
  ComposioConnection,
  ComposioVisibility,
  EnvironmentId,
  LibraryVisibility,
} from "@otto/contracts";
import {
  RiAddLine,
  RiDeleteBinLine,
  RiFlashlightLine,
  RiPuzzleLine,
  RiSearchLine,
  RiToolsLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Skeleton, SkeletonAppDetail, SkeletonCustomizeRows } from "../ui/skeleton";
import { SettingsPageContainer } from "../settings/settings-layout";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PageTitle } from "../workspace-page-container";
import {
  CustomizeEmpty,
  CustomizeGroup,
  CustomizeItem,
  CustomizeRow,
  LogoTile,
} from "./customize-group";
import { DetailHeader } from "./customize-detail";
import { AppLogo, ConnectionStatus, useComposio } from "./customize-integrations";
import { ConnectAppDialog } from "./connect-app-dialog";

function AppsCatalogSkeleton() {
  const { t } = useI18n();

  return (
    <>
      <Skeleton className="h-8 w-full rounded-md" />
      <SkeletonCustomizeRows label={t("Loading settings")} rows={6} />
    </>
  );
}

/** Shown instead of the catalog until someone adds a Composio key. */
function NotConfigured({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { t } = useI18n();

  return (
    <CustomizeEmpty
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
        <CustomizeEmpty
          icon={<RiPuzzleLine />}
          title={t("Couldn't load apps")}
          description={t("Could not reach Composio: {error}", { error: String(toolkits.error) })}
        />
      ) : toolkits.data === undefined ? (
        <SkeletonCustomizeRows label={t("Loading settings")} rows={6} />
      ) : apps.length === 0 ? (
        <CustomizeEmpty
          icon={<RiSearchLine />}
          title={t("No apps")}
          description={
            deferredSearch
              ? t("No apps match “{query}”.", { query: deferredSearch })
              : t("Composio lists no apps for this key.")
          }
        />
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
  const { t } = useI18n();
  const composio = useComposio(environmentId);

  if (composio.status.error && !composio.status.data) {
    return (
      <CustomizeEmpty
        icon={<RiPuzzleLine />}
        title={t("Couldn't load apps")}
        description={t("Could not reach Composio: {error}", {
          error: String(composio.status.error),
        })}
      />
    );
  }

  if (!composio.status.data) return <AppsCatalogSkeleton />;

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
      ) : (
        <AppsCatalogSkeleton />
      )}
    </SettingsPageContainer>
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

    if (!composio.failed(t("{name} couldn't be updated", { name }), result))
      composio.status.refresh();
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

    if (!composio.failed(t("{name} couldn't be disconnected", { name }), result)) {
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
    const missing = detail.error.includes("does not list");

    return (
      <CustomizeEmpty
        icon={<RiPuzzleLine />}
        title={missing ? t("Not found") : t("Couldn't load this app")}
        description={t("Could not reach Composio: {error}", { error: String(detail.error) })}
      />
    );
  }

  if (!detail.data) return <SkeletonAppDetail label={t("Loading settings")} />;
  const { toolkit, tools, triggers } = detail.data;

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
      <CustomizeGroup
        title={t("Triggers")}
        count={triggers.length}
        empty={
          triggers.length === 0
            ? { icon: <RiFlashlightLine />, description: t("No triggers") }
            : null
        }
      >
        {triggers.map((trigger) => (
          <CustomizeItem
            key={trigger.slug}
            icon={<RiFlashlightLine aria-hidden className="size-4" />}
            name={trigger.name}
            description={trigger.description}
          />
        ))}
      </CustomizeGroup>
      {connecting ? (
        <ConnectAppDialog
          environmentId={environmentId}
          toolkit={toolkit}
          visibility={visibility}
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
 * tools it gives bots and the triggers (app events) that can start a routine, each in a card row. Connect opens a small dialog: a label (required,
 * unique among the person's own accounts for the app) and Yours or Team. Apps Composio hosts stop there.
 * Apps it does not host also ask for an existing auth config or a new one, as choice cards, using the fields Composio lists.
 * Otto forwards those fields and does not store them.
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
