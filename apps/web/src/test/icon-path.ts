import type { RemixiconComponentType } from "@remixicon/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function iconPath(icon: RemixiconComponentType): string {
  const path = renderToStaticMarkup(createElement(icon)).match(/<path d="([^"]+)"/)?.[1];

  if (!path) throw new Error("Expected a Remix SVG path.");

  return path;
}
