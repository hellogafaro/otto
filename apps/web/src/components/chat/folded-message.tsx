import { RiArrowDownSLine, RiArrowUpSLine } from "@remixicon/react";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

// Otto: A message taller than 480px folds to its first 320px (`max-h-80`), so a fold always
// hides at least a third of it; shorter messages never fold.
const FOLD_AT_PX = 480;

/**
 * A message body that folds when it is long: the clipped text fades out over its last 64px
 * above a Show more control, which becomes Show less once expanded.
 */
export function FoldedMessage({
  children,
  className,
  startExpanded = false,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  /** A reply that mounts while streaming stays open, so it never folds under its reader. */
  readonly startExpanded?: boolean;
}) {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(startExpanded);

  useLayoutEffect(() => {
    const content = contentRef.current;

    if (!content) return;
    const measure = () => setLong(content.offsetHeight > FOLD_AT_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);

    return () => observer.disconnect();
  }, []);

  const folded = long && !expanded;

  const toggle = () => {
    setExpanded(!expanded);

    if (expanded) {
      requestAnimationFrame(() => toggleRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };

  return (
    <div className={className}>
      <div
        className={cn(folded && "max-h-80 overflow-y-clip mask-b-from-80%")}
        data-folded={folded || undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {long ? (
        <Button
          ref={toggleRef}
          aria-expanded={expanded}
          className="-ms-2 mt-1"
          size="xs"
          variant="ghost-muted"
          onClick={toggle}
        >
          {expanded ? t("Show less") : t("Show more")}
          {expanded ? <RiArrowUpSLine /> : <RiArrowDownSLine />}
        </Button>
      ) : null}
    </div>
  );
}
