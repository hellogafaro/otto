import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { Button } from "../components/ui/button";
import {
  errorDetails,
  errorMessage,
  RootRouteErrorView,
  RouteErrorState,
} from "./-root-route-error-view";

interface ActionElementProps {
  readonly children?: ReactNode;
  readonly onClick?: () => void;
}

function findButtons(node: ReactNode): ReactElement<ActionElementProps>[] {
  if (!isValidElement<ActionElementProps>(node)) return [];
  const match = node.type === Button ? [node] : [];

  return [...match, ...Children.toArray(node.props.children).flatMap(findButtons)];
}

describe("RootRouteErrorView", () => {
  it("leads with the plain empty state and keeps the error behind Show details", () => {
    const markup = renderToStaticMarkup(
      <RootRouteErrorView
        error={new TypeError("bots.filter is not a function")}
        reload={() => {}}
        reset={() => {}}
      />,
    );

    expect(markup).toContain('aria-labelledby="route-error-title"');
    expect(markup).toContain("Something went wrong");
    expect(markup).toContain(
      "This page couldn&#x27;t load. Try again, or reload Otto if it keeps happening.",
    );
    expect(markup).toContain("<details");
    expect(markup).toContain("Show details");
    expect(markup).toContain("bots.filter is not a function");
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain('role="alert"');
    expect(markup.indexOf("Something went wrong")).toBeLessThan(markup.indexOf("Show details"));
  });

  it("offers try again and a full reload as separate recovery actions", () => {
    const reset = vi.fn();
    const reload = vi.fn();
    const view = RouteErrorState({ error: new Error("Failed to load"), reload, reset });
    const [retryButton, reloadButton] = findButtons(view);

    expect(Children.toArray(retryButton?.props.children)).toContain("Try again");
    expect(Children.toArray(reloadButton?.props.children)).toContain("Reload Otto");

    retryButton?.props.onClick?.();
    reloadButton?.props.onClick?.();

    expect(reset).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("provides useful fallbacks for unknown and unserializable errors", () => {
    type CircularFixture = { self?: CircularFixture };

    const circular: CircularFixture = {};
    circular.self = circular;

    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("failed to connect")).toBe("failed to connect");
    expect(errorMessage("   ")).toBe("An unexpected error stopped this view from loading.");
    expect(errorDetails("failed to connect")).toBe("failed to connect");
    expect(errorDetails(circular)).toBe("No additional error details are available.");
  });
});
