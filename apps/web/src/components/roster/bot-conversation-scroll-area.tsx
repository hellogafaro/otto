import { RiArrowDownLine } from "@remixicon/react";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { UNREAD_BOUNDARY_ATTRIBUTE } from "../chat/unread-boundary";
import { Button } from "../ui/button";
import { CONVERSATION_MEASURE_CLASS_NAME } from "./bot-conversation-presentation";
import {
  didScrollAwayFromEnd,
  isConversationAtEnd,
  reduceConversationFollowState,
  unreadBoundaryScrollTop,
  type ConversationFollowEvent,
  type ConversationFollowState,
  type ConversationScrollMetrics,
} from "./bot-conversation-scroll.logic";

function readMetrics(viewport: HTMLElement): ConversationScrollMetrics {
  return {
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
  };
}

/**
 * Scrolls a chat and keeps it pinned to the newest content while the reader is at
 * the end. Scrolling up unpins it and reveals a jump-to-latest button. A change to
 * `followKey` (for example the id of the newest user message) re-pins it, so
 * sending a message always lands at the end. `anchorKey` is the unread New mark:
 * the open view lands on it once when it would otherwise sit above the fold.
 */
export function BotConversationScrollArea({
  children,
  followKey,
  anchorKey,
}: {
  readonly children: ReactNode;
  readonly followKey?: string | null | undefined;
  readonly anchorKey?: string | null | undefined;
}) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followStateRef = useRef<ConversationFollowState>({ followingEnd: true });
  const [isAtEnd, setIsAtEnd] = useState(true);
  const landedAnchorRef = useRef<string | null>(null);
  const followKeyAtLandingRef = useRef<string | null | undefined>(undefined);
  const movedToAnchorRef = useRef(false);

  const dispatch = (event: ConversationFollowEvent) => {
    followStateRef.current = reduceConversationFollowState(followStateRef.current, event);
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;

    if (!viewport || !content) return;

    let lastMetrics = readMetrics(viewport);

    const updateScrollState = () => {
      const metrics = readMetrics(viewport);
      const nextIsAtEnd = isConversationAtEnd(metrics);

      if (nextIsAtEnd) movedToAnchorRef.current = false;

      setIsAtEnd(nextIsAtEnd);
      dispatch({
        type: "scroll",
        isAtEnd: nextIsAtEnd,
        movedAway: didScrollAwayFromEnd(lastMetrics, metrics),
      });
      lastMetrics = metrics;
    };

    // Content growth and viewport resizes (composer growing, window resize) both
    // move the end. Re-pin before paint when the reader is following it.
    const followLayoutChange = () => {
      if (followStateRef.current.followingEnd && !movedToAnchorRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }

      updateScrollState();
    };

    if (!movedToAnchorRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    updateScrollState();

    const observer = new ResizeObserver(followLayoutChange);
    observer.observe(content);
    observer.observe(viewport);
    viewport.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;

    if (!anchorKey || !viewport || landedAnchorRef.current === anchorKey) return;

    const anchor = viewport.querySelector(
      `[${UNREAD_BOUNDARY_ATTRIBUTE}="${CSS.escape(anchorKey)}"]`,
    );

    if (!(anchor instanceof HTMLElement)) return;

    const viewportRect = viewport.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();

    const nextTop = unreadBoundaryScrollTop(
      { scrollTop: viewport.scrollTop, top: viewportRect.top, bottom: viewportRect.bottom },
      { top: anchorRect.top, bottom: anchorRect.bottom },
    );

    landedAnchorRef.current = anchorKey;
    followKeyAtLandingRef.current = followKey;

    if (nextTop === null) return;

    movedToAnchorRef.current = true;
    dispatch({ type: "user-navigation" });
    viewport.scrollTop = nextTop;
  });

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!followKey || !viewport) return;

    if (landedAnchorRef.current && followKey === followKeyAtLandingRef.current) return;

    movedToAnchorRef.current = false;
    dispatch({ type: "scroll-to-end" });
    viewport.scrollTop = viewport.scrollHeight;
  }, [followKey]);

  const scrollToEnd = () => {
    const viewport = viewportRef.current;

    if (!viewport) return;
    movedToAnchorRef.current = false;
    dispatch({ type: "scroll-to-end" });
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="bot-conversation-scroll-area">
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 scroll-fade-y overflow-y-auto overscroll-contain px-4 pt-6 pb-1 scrollbar-gutter-stable-both sm:px-6"
        data-testid="bot-conversation-viewport"
        onWheel={(event) => {
          if (event.deltaY < 0) dispatch({ type: "user-navigation" });
        }}
      >
        <div ref={contentRef} className="flex min-h-full w-full flex-col">
          <div className={cn("mt-auto flex flex-col gap-1", CONVERSATION_MEASURE_CLASS_NAME)}>
            {children}
          </div>
        </div>
      </div>

      {/* A gutter outside the scrolling content, so the button never covers a message. */}
      <div className="flex h-9 shrink-0 items-center justify-center">
        {!isAtEnd ? (
          <Button
            type="button"
            variant="outline-pill-muted"
            size="icon-sm"
            aria-label={t("Scroll to latest message")}
            onClick={scrollToEnd}
          >
            <RiArrowDownLine className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
