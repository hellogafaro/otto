import { RiArrowDownSLine, type RemixiconComponentType } from "@remixicon/react";
import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SelectTrigger } from "../ui/select";

const composerControlClassName =
  "h-7 min-h-7 [&_svg[data-composer-control-icon]]:mx-0 [&_svg[data-composer-control-chevron]]:-mx-0.5";

export function ComposerControl({
  className,
  size = "sm",
  variant = "ghost",
  presentation = "composer-control",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      presentation={presentation}
      className={cn(composerControlClassName, className)}
      size={size}
      variant={variant}
      {...props}
    />
  );
}

export function ComposerControlIcon({
  icon: Icon,
  className,
  opticalSize = "default",
}: {
  icon: RemixiconComponentType;
  className?: string | undefined;
  opticalSize?: "default" | "large";
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn("shrink-0", opticalSize === "large" ? "size-4.5" : "size-4", className)}
      data-composer-control-icon
    />
  );
}

export function ComposerControlChevron() {
  return (
    <RiArrowDownSLine
      aria-hidden="true"
      className="-mx-0.5 size-3.5 shrink-0 text-icon-muted"
      data-composer-control-chevron
    />
  );
}

export function ComposerSelectControl({
  className,
  size = "sm",
  variant = "ghost",
  ...props
}: ComponentProps<typeof SelectTrigger>) {
  return (
    <SelectTrigger
      presentation="composer-control"
      className={cn(composerControlClassName, className)}
      icon={<ComposerControlChevron />}
      size={size}
      variant={variant}
      {...props}
    />
  );
}
