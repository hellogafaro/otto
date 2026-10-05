import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import type { ReactNode } from "react";

// A section of a settings page: an h2 with one muted line, then a card of rows
// split by hairlines.
export function Group({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      {title && (
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-medium">{title}</h2>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="-mx-4 flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 [&>[data-slot=item]+[data-slot=item]]:border-t-border">
        {children}
      </div>
    </section>
  );
}

// What it is and a line on it on the left, controls on the right.
export function Row({
  title,
  description,
  media,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  media?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Item className="rounded-none px-[15px]">
      {media && <ItemMedia>{media}</ItemMedia>}
      <ItemContent className="gap-0.5">
        <ItemTitle>{title}</ItemTitle>
        {description && (
          <ItemDescription className="text-xs">{description}</ItemDescription>
        )}
      </ItemContent>
      {children && <ItemActions>{children}</ItemActions>}
    </Item>
  );
}
