import { hasTag } from "~/lib/tagged-union";
import { type ServerLifecycleWelcomePayload } from "@otto/contracts";
import { Outlet, createRootRoute, redirect, useLocation } from "@tanstack/react-router";
import { getOrganizationAccountState } from "@otto/client-runtime/authorization";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_BASE_NAME, APP_DISPLAY_NAME, APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppDisplayName } from "../branding.logic";
import { AppSidebarLayout } from "../components/app-sidebar-layout";
import { CommandPalette } from "../components/command-palette";
import { ConfirmDialogHost } from "../components/confirm-dialog-host";
import { SshPasswordPromptDialog } from "../components/desktop/ssh-password-prompt-dialog";
import { ReplyPlaybackProvider } from "../components/chat/reply-playback-provider";
import { VoiceCallProvider } from "../components/voice/voice-call";
import { SlowRpcRequestToastCoordinator } from "../components/slow-rpc-request-toast-coordinator";
import { SurfaceNavigationCoordinator } from "../components/surface-navigation-coordinator";
import { ComputerViewerDialog } from "../components/computer/computer-viewer-dialog";
import { NewChatDialogHost } from "../components/roster/new-chat-dialog";
import { TranslatedRouteErrorView } from "./-root-route-error-view";
import { useI18n } from "../i18n";
import { toast } from "sonner";
import { Toaster } from "../components/ui/sonner";
import { resolveAndPersistPreferredEditor } from "../editor-preferences";
import { applyAppearanceFontVariables } from "~/appearance-fonts";
import { useClientSettings } from "../hooks/use-settings";
import { PlanAgentSelectionHeal } from "../plan-agent-selection-heal";
import { syncBrowserChromeTheme } from "../hooks/use-theme";
import { configureClientTracing } from "../observability/client-tracing";
import {
  readPrimaryEnvironmentTarget,
  resolveInitialServerAuthGateState,
} from "../environments/primary";
import { shellEnvironment } from "../state/shell";
import { useAtomValue } from "@effect/atom-react";
import { useAtomCommand } from "../state/use-atom-command";
import { usePrimaryEnvironment } from "../state/environments";
import {
  primaryServerConfigAtom,
  primaryServerConfigEventAtom,
  primaryServerWelcomeAtom,
} from "../state/server";
import { setActiveEnvironmentId } from "../state/entities";
import {
  createKeybindingsUpdateToastController,
  type KeybindingsUpdateToastController,
} from "../components/keybindings-update-toast.logic";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const authGateState = await resolveInitialServerAuthGateState();

    if (
      authGateState.status === "requires-auth" &&
      authGateState.auth.bootstrapMethods.includes("email-password")
    ) {
      const baseURL = readPrimaryEnvironmentTarget()?.target.httpBaseUrl ?? window.location.origin;

      const account = await getOrganizationAccountState(baseURL, undefined, {
        bearer: Boolean(window.desktopBridge),
      });

      if (!account.organization && location.pathname !== "/setup") {
        throw redirect({ to: "/setup", hash: location.hash, replace: true });
      }

      if (account.organization && location.pathname === "/setup") {
        throw redirect({ to: "/login", replace: true });
      }
    }

    return {
      authGateState,
    };
  },
  component: RootRouteView,
  errorComponent: TranslatedRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { authGateState } = Route.useRouteContext();
  const primaryEnvironmentAuthenticated = authGateState.status === "authenticated";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncBrowserChromeTheme();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  if (
    ["/login", "/setup", "/reset-password"].includes(pathname) ||
    pathname.startsWith("/invite/")
  ) {
    return (
      <>
        <DocumentTitleSync />
        <Outlet />
      </>
    );
  }

  if (authGateState.status !== "authenticated") {
    return (
      <>
        <DocumentTitleSync />
        <Outlet />
      </>
    );
  }

  const appShell = (
    <CommandPalette>
      <AppSidebarLayout>
        <Outlet />
      </AppSidebarLayout>
    </CommandPalette>
  );

  return (
    <>
      <DocumentTitleSync />
      <FontAppearanceSync />
      {primaryEnvironmentAuthenticated ? <AuthenticatedTracingBootstrap /> : null}
      <SshPasswordPromptDialog />
      <ConfirmDialogHost />
      <SlowRpcRequestToastCoordinator />
      <SurfaceNavigationCoordinator />
      {primaryEnvironmentAuthenticated ? <EventRouter /> : null}
      {primaryEnvironmentAuthenticated ? <PlanAgentSelectionHeal /> : null}
      <ReplyPlaybackProvider>
        <VoiceCallProvider>{appShell}</VoiceCallProvider>
      </ReplyPlaybackProvider>
      <ComputerViewerDialog />
      {primaryEnvironmentAuthenticated ? <NewChatDialogHost /> : null}
      <Toaster />
    </>
  );
}

function FontAppearanceSync() {
  const fontSizeInterface = useClientSettings((settings) => settings.fontSizeInterface);
  const fontSizeCode = useClientSettings((settings) => settings.fontSizeCode);

  useEffect(() => {
    applyAppearanceFontVariables(document.documentElement, {
      sizeInterface: fontSizeInterface,
      sizeCode: fontSizeCode,
    });
  }, [fontSizeCode, fontSizeInterface]);

  return null;
}

function DocumentTitleSync() {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  const title = resolveServerBackedAppDisplayName({
    baseName: APP_BASE_NAME,
    fallbackDisplayName: APP_DISPLAY_NAME,
    fallbackStageLabel: APP_STAGE_LABEL,
    primaryServerVersion,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

function AuthenticatedTracingBootstrap() {
  useEffect(() => {
    void configureClientTracing();
  }, []);

  return null;
}

function EventRouter() {
  const { t } = useI18n();
  const primaryEnvironment = usePrimaryEnvironment();

  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });

  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverConfigEvent = useAtomValue(primaryServerConfigEventAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const handledConfigEventRef = useRef(serverConfigEvent);

  const [keybindingsToastController] = useState<KeybindingsUpdateToastController>(() =>
    createKeybindingsUpdateToastController({}),
  );

  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload) return;

    setActiveEnvironmentId(payload.environment.environmentId);
  });

  const handleServerConfigUpdated = useEffectEvent(() => {
    const decision = keybindingsToastController.handle(serverConfigEvent);

    if (!decision) {
      return;
    }

    if (hasTag(decision, "Success")) {
      toast.success(t("Shortcuts have been updated"));

      return;
    }

    toast.warning(t("Shortcuts file isn't valid"), {
      action: {
        label: t("Open keybindings.json"),
        onClick: () => {
          if (!serverConfig || !primaryEnvironment) {
            return;
          }

          const editor = resolveAndPersistPreferredEditor(serverConfig.availableEditors);

          if (!editor) {
            return;
          }

          void (async () => {
            const result = await openInEditor({
              environmentId: primaryEnvironment.environmentId,
              input: {
                cwd: serverConfig.keybindingsConfigPath,
                editor,
              },
            });

            if (hasTag(result, "Success")) {
              return;
            }

            toast.error(t("Shortcuts file couldn't be opened"));
          })();
        },
      },
    });
  });

  useEffect(() => {
    if (!serverConfig) {
      return;
    }

    setActiveEnvironmentId(serverConfig.environment.environmentId);
  }, [serverConfig]);

  useEffect(() => {
    handleWelcome(serverWelcome);
  }, [serverWelcome]);

  useEffect(() => {
    if (serverConfigEvent === null || handledConfigEventRef.current === serverConfigEvent) {
      return;
    }

    handledConfigEventRef.current = serverConfigEvent;
    handleServerConfigUpdated();
  }, [serverConfigEvent]);

  return null;
}
