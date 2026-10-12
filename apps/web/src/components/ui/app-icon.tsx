import type { RemixiconComponentType } from "@remixicon/react";
import type { ComponentProps } from "react";
import { cn } from "~/lib/utils";

export function AppIcon({
  icon: Icon,
  tone,
  fit,
  className,
  ...props
}: ComponentProps<RemixiconComponentType> & {
  icon: RemixiconComponentType;
  tone?: "muted" | "muted-hover" | "sidebar" | "sidebar-muted" | undefined;
  /** "inline-chip" sizes the icon like the other inline chip icons (COMPOSER_INLINE_CHIP_ICON_CLASS_NAME). */
  fit?: "inline-chip" | undefined;
}) {
  return (
    <Icon
      aria-hidden="true"
      className={
        tone || fit
          ? cn(
              fit === "inline-chip" &&
                "block size-[1.17em] shrink-0 self-center opacity-85 [&>svg]:block",
              tone === "muted" && "text-muted-foreground",
              tone === "muted-hover" &&
                "text-muted-foreground transition-colors group-hover:text-foreground",
              tone === "sidebar" && "text-sidebar-foreground",
              tone === "sidebar-muted" && "text-sidebar-muted-foreground",
              className,
            )
          : className
      }
      {...props}
    />
  );
}
