import { parseMentionHref } from "@otto/shared/mention";
import { RiReplyLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";

/** Otto: the one mention look, a quiet info-tinted pill, in a comment and in a bot's reply. */
export const MENTION_CLASS_NAME =
  "rounded-sm bg-info/8 px-0.5 font-medium text-info-foreground dark:bg-info/16";

/** Draws a `#mention/<type>/<id>` link as the mention pill. Anything else stays a normal link. */
export function renderMentionLink(
  href: string,
  children: ReactNode,
  open: (mention: { readonly type: string; readonly id: string }) => void,
): ReactNode {
  const mention = parseMentionHref(href);

  if (mention === null) return null;

  if (mention.type === "task" || mention.type === "project" || mention.type === "library") {
    return (
      <button type="button" className={MENTION_CLASS_NAME} onClick={() => open(mention)}>
        @{children}
      </button>
    );
  }

  if (mention.type === "comment") {
    return (
      <button
        type="button"
        className={cn(MENTION_CLASS_NAME, "inline-flex items-center gap-0.5 align-bottom")}
        onClick={() =>
          document
            .getElementById(`activity-${mention.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      >
        <RiReplyLine aria-hidden className="size-3.5" />
        {children}
      </button>
    );
  }

  return <span className={MENTION_CLASS_NAME}>@{children}</span>;
}

/** The mention pill, opening a task, project or Library file in the app. */
export function useMentionLink() {
  const navigate = useNavigate();

  return (href: string, children: ReactNode) =>
    renderMentionLink(href, children, (mention) => {
      if (mention.type === "task") {
        void navigate({ to: "/tasks/$taskId", params: { taskId: mention.id } });
      } else if (mention.type === "project") {
        void navigate({ to: "/projects/$projectId", params: { projectId: mention.id } });
      } else if (mention.type === "library") {
        void navigate({ to: "/library/$fileId", params: { fileId: mention.id } });
      }
    });
}
