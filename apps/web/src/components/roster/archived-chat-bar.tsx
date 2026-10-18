import type { ScopedThreadRef } from "@otto/contracts";
import { RiInboxUnarchiveLine } from "@remixicon/react";
import { useState } from "react";

import { useChatActions } from "../../hooks/use-chat-actions";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { CONVERSATION_MEASURE_CLASS_NAME } from "./bot-conversation-presentation";

/**
 * Otto: An archived chat stays readable; this bar takes the composer's place, at its width, and
 * Unarchive brings the composer back.
 */
export function ArchivedChatBar({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { t } = useI18n();
  const actions = useChatActions();
  const [unarchiving, setUnarchiving] = useState(false);

  const unarchive = async () => {
    setUnarchiving(true);

    try {
      await actions.unarchive(threadRef);
    } finally {
      setUnarchiving(false);
    }
  };

  return (
    <div
      className="w-full px-gutter-48rem pt-2 pb-4 sm:px-gutter-48rem-wide sm:pb-6"
      data-testid="archived-chat-bar"
    >
      <div
        className={cn(
          CONVERSATION_MEASURE_CLASS_NAME,
          "flex min-h-10 items-center gap-3 rounded-xl border bg-muted/40 py-1.5 ps-4 pe-1.5",
        )}
      >
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t("This chat is archived.")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unarchiving}
          onClick={() => void unarchive()}
        >
          <RiInboxUnarchiveLine className="size-3.5" />
          {t("Unarchive")}
        </Button>
      </div>
    </div>
  );
}
