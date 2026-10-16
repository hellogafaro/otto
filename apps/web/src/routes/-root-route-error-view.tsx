import * as Predicate from "effect/Predicate";
import { createTranslator, type TranslationParams } from "@otto/client-runtime/i18n";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { RiErrorWarningLine } from "@remixicon/react";
import { createPortal } from "react-dom";

import { Button } from "../components/ui/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "../components/ui/code-block";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { useI18n } from "../i18n";

type Translate = (message: string, params?: TranslationParams) => string;

const english: Translate = createTranslator("en").translate;

function reloadApp() {
  window.location.reload();
}

interface RouteErrorViewProps extends ErrorComponentProps {
  readonly reload?: () => void;
  /** Interface copy lookup. Defaults to English; the raw error is never translated. */
  readonly t?: Translate;
}

/**
 * Every route's error component, the root's included. Reads the language through `useI18n`,
 * which falls back to English when the failure happened above `LanguageProvider`. It portals
 * to the body so a failure inside a panel still covers the whole window.
 */
export function TranslatedRouteErrorView(props: RouteErrorViewProps) {
  const { t } = useI18n();

  return createPortal(<RouteErrorView {...props} t={t} />, document.body);
}

/**
 * Otto: The one error screen, full window, no logo: the warning glyph, "Something went wrong",
 * one sentence, a single Reload, and the whole error trace in a code block with a copy button.
 */
export function RouteErrorView({ error, reload = reloadApp, t = english }: RouteErrorViewProps) {
  const details = errorDetails(error, t);

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background p-6 text-foreground">
      <Empty aria-labelledby="route-error-title" role="region" className="w-full max-w-xl">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RiErrorWarningLine />
          </EmptyMedia>
          <EmptyTitle id="route-error-title">{t("Something went wrong")}</EmptyTitle>
          <EmptyDescription>{t("Otto hit an error. Reload to try again.")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="w-full max-w-xl">
          <Button onClick={reload}>{t("Reload")}</Button>
          <CodeBlock size="sm" className="text-left">
            <CodeBlockActions>
              <CodeBlockCopyButton value={details} />
            </CodeBlockActions>
            <CodeBlockContent wrap className="max-h-64" tabIndex={0}>
              {details}
            </CodeBlockContent>
          </CodeBlock>
        </EmptyContent>
      </Empty>
    </main>
  );
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
