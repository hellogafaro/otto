import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

// Otto: Empty states share one rhythm: 16px from icon to title, 4px to the description, 20px to actions.
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center text-balance p-6 text-center md:p-12",
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex max-w-sm flex-col items-center text-center", className)}
      data-slot="empty-header"
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground [&_svg]:size-4!",
      },
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      className={cn("relative mb-4", className)}
      data-slot="empty-media"
      data-variant={variant}
      {...props}
    >
      <div className={cn(emptyMediaVariants({ className, variant }))} {...props} />
    </div>
  );
}

/** `body` sets the title in the body face at medium weight, for small in-panel states. */
function EmptyTitle({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "body";
}) {
  return (
    <div
      className={cn(
        "text-base font-medium tracking-title-sm text-foreground",
        variant === "body" && "text-13px tracking-normal",
        className,
      )}
      data-slot="empty-title"
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      className={cn(
        "text-13px leading-copy text-muted-foreground [&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4 [[data-slot=empty-title]+&]:mt-1",
        className,
      )}
      data-slot="empty-description"
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-5 flex w-full min-w-0 max-w-sm flex-col items-center gap-2 text-balance text-13px",
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  );
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };
