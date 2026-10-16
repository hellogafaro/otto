import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { Button } from "../components/ui/button";
import { errorDetails, RouteErrorView } from "./-root-route-error-view";

interface ActionElementProps {
  readonly children?: ReactNode;
  readonly onClick?: () => void;
}

function findButtons(node: ReactNode): ReactElement<ActionElementProps>[] {
  if (!isValidElement<ActionElementProps>(node)) return [];
  const match = node.type === Button ? [node] : [];

  return [...match, ...Children.toArray(node.props.children).flatMap(findButtons)];
}

describe("RouteErrorView", () => {
  it("shows the whole error trace in a copyable code block, with no logo", () => {
    const error = new TypeError("bots.filter is not a function");

    const markup = renderToStaticMarkup(
      <RouteErrorView error={error} reload={() => {}} reset={() => {}} />,
    );

    expect(markup).toContain('aria-labelledby="route-error-title"');
    expect(markup).toContain("Something went wrong");
    expect(markup).toContain('data-slot="code-block-content"');
    expect(markup).toContain('data-slot="code-block-copy-button"');
    expect(markup).toContain("bots.filter is not a function");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("wordmark");
  });

  it("offers a single Reload", () => {
    const reload = vi.fn();

    const buttons = findButtons(
      RouteErrorView({ error: new Error("Failed to load"), reload, reset: () => {} }),
    );

    expect(buttons).toHaveLength(1);
    expect(Children.toArray(buttons[0]?.props.children)).toContain("Reload");
    buttons[0]?.props.onClick?.();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("provides a fallback for unserializable errors", () => {
    type CircularFixture = { self?: CircularFixture };

    const circular: CircularFixture = {};
    circular.self = circular;

    expect(errorDetails("failed to connect")).toBe("failed to connect");
    expect(errorDetails(circular)).toBe("No additional error details are available.");
  });
});
