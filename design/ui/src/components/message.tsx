import { cn } from "cn";
import type * as React from "react";

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

// Otto: a 28px slot for an md Avatar (stock: 32px), which brings its own fill
// and shape (a rounded square, so the slot doesn't clip it to a circle). It
// sits at the top, beside the name, as group chats do (stock bottom-aligns it
// beside the last bubble), 4px down: its top 2px above the name's capitals
// (the 20px header line starts 6px above them), as Slack sets it.
function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "mt-1 flex w-fit min-w-7 shrink-0 items-center justify-center self-start",
        className,
      )}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col gap-2.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end",
        className,
      )}
      {...props}
    />
  );
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0",
        className,
      )}
      {...props}
    />
  );
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex max-w-full min-w-0 items-center px-3 text-xs font-medium text-muted-foreground group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end",
        className,
      )}
      {...props}
    />
  );
}

// Otto: an author's name carries an assigned color (like Slack), so a chat's
// senders group at a glance: six hues, each tuned per theme to read on the
// background in light and dark; none is the primary blue, so a name never reads
// as an @tag. The app picks one per actor with a stable hash.
const messageAuthorColors = [
  "text-[oklch(0.55_0.18_25)] dark:text-[oklch(0.74_0.14_25)]", // red
  "text-[oklch(0.56_0.15_60)] dark:text-[oklch(0.78_0.13_65)]", // orange
  "text-[oklch(0.52_0.14_150)] dark:text-[oklch(0.77_0.14_150)]", // green
  "text-[oklch(0.53_0.1_195)] dark:text-[oklch(0.77_0.1_195)]", // teal
  "text-[oklch(0.52_0.18_300)] dark:text-[oklch(0.75_0.14_300)]", // purple
  "text-[oklch(0.56_0.19_350)] dark:text-[oklch(0.75_0.15_350)]", // pink
] as const;

export {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  messageAuthorColors,
};
