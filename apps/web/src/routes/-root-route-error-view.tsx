import * as Predicate from "effect/Predicate";
import { createTranslator, type TranslationParams } from "@otto/client-runtime/i18n";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { RiErrorWarningLine } from "@remixicon/react";
import { useContext } from "react";

import { APP_DISPLAY_NAME } from "../branding";
import { OttoWordmark } from "../components/otto-wordmark";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarContext } from "../components/ui/sidebar-context";
import { WorkPage } from "../components/work/work-pages";
import { useI18n } from "../i18n";

type Translate = (message: string, params?: TranslationParams) => string;

const english: Translate = createTranslator("en").translate;

function reloadApp() {
  window.location.reload();
}

interface RootRouteErrorViewProps extends ErrorComponentProps {
  readonly reload?: () => void;
  /** Interface copy lookup. Defaults to English; the raw error is never translated. */
  readonly t?: Translate;
}

/**
 * The root route's error component, for failures above the app shell. Reads the language
 * through `useI18n`, which falls back to English when the failure happened above
 * `LanguageProvider`.
 */
export function TranslatedRootRouteErrorView(props: RootRouteErrorViewProps) {
  const { t } = useI18n();

  return <RootRouteErrorView {...props} t={t} />;
}

/**
 * Every other route's error component: inside the app shell the page fails in place with the
 * sidebar intact; sign-in and other shell-less pages get the full-page view.
 */
export function TranslatedRouteErrorView(props: RootRouteErrorViewProps) {
  const { t } = useI18n();

  if (useContext(SidebarContext) === null) return <RootRouteErrorView {...props} t={t} />;

  return (
    <WorkPage>
      <RouteErrorState {...props} t={t} />
    </WorkPage>
  );
}

export function RootRouteErrorView(props: RootRouteErrorViewProps) {
  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-(--workspace-topbar-height) shrink-0 items-center gap-1.5 pl-(--workspace-controls-left) pr-(--workspace-controls-right)">
        <OttoWordmark aria-hidden className="text-2xl text-foreground" />
        <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          {APP_DISPLAY_NAME}
        </span>
      </header>
      <RouteErrorState {...props} />
    </main>
  );
}

/**
 * Otto: A failed page is the shared empty state: the warning glyph, "Something went wrong",
 * one sentence, Try again and Reload Otto, and the error itself behind a quiet Show details.
 */
export function RouteErrorState({
  error,
  reset,
  reload = reloadApp,
  t = english,
}: RootRouteErrorViewProps) {
  return (
    <Empty aria-labelledby="route-error-title" role="region">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiErrorWarningLine />
        </EmptyMedia>
        <EmptyTitle id="route-error-title">{t("Something went wrong")}</EmptyTitle>
        <EmptyDescription>
          {t("This page couldn't load. Try again, or reload Otto if it keeps happening.")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button onClick={() => reset()}>{t("Try again")}</Button>
          <Button onClick={reload} variant="outline">
            {t("Reload Otto")}
          </Button>
        </div>
        <details className="w-full max-w-md">
          <summary className="cursor-pointer list-none rounded-(--control-radius) px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {t("Show details")}
          </summary>
          <pre
            className="mt-2 max-h-52 overflow-auto rounded-lg border border-border bg-card px-3 py-2.5 text-left font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground"
            tabIndex={0}
          >
            {errorDetails(error, t)}
          </pre>
        </details>
      </EmptyContent>
    </Empty>
  );
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) {
    return cause.message;
  }

  if (Predicate.isString(cause) && cause.trim().length > 0) {
    return cause;
  }

  return "An unexpected error stopped this view from loading.";
}

export function errorDetails(cause: unknown, t: Translate = english): string {
  if (cause instanceof Error) {
    return cause.stack ?? cause.message;
  }

  if (Predicate.isString(cause)) {
    return cause;
  }

  try {
    return JSON.stringify(cause, null, 2);
  } catch {
    return t("No additional error details are available.");
  }
}
