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

// Otto: per-message actions stay quiet on desktop and remain usable on touch.
function MessageItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-item"
      className={cn(
        "group/message-item relative flex min-w-0 flex-col gap-2",
        className,
      )}
      {...props}
    />
  );
}

function MessageActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-actions"
      className={cn(
        "absolute top-0 right-0 flex items-center gap-0.5 rounded-md bg-background [@media(hover:hover)]:opacity-0 group-hover/message-item:opacity-100 group-focus-within/message-item:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

// Otto: one flat quote, shared by the draft and saved message presentation.
function MessageQuote({
  className,
  ...props
}: React.ComponentProps<"blockquote">) {
  return (
    <blockquote
      data-slot="message-quote"
      className={cn(
        "flex min-w-0 items-start gap-2 border-l-2 border-border pl-3 text-sm text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Message,
  MessageActions,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageItem,
  MessageQuote,
};
