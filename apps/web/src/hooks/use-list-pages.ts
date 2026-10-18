import { useCallback, useEffect, useRef, useState } from "react";

type ListPagesStatus = "loading" | "ready" | "more" | "error";

/**
 * Otto: A bounded server list read page by page. `view` names its filter and order: a new view
 * starts over from the first page. A new `revision` means something in the list changed, so the
 * pages already shown load again in place, keeping the reader where they are.
 */
export function useListPages<Page>({
  view,
  revision,
  fetchPage,
  getNextCursor,
}: {
  readonly view: string;
  readonly revision: unknown;
  /** One page after `cursor`, or null when it could not be read. */
  readonly fetchPage: (cursor: string | undefined) => Promise<Page | null>;
  readonly getNextCursor: (page: Page) => string | null;
}) {
  const [state, setState] = useState<{
    readonly pages: readonly Page[];
    readonly status: ListPagesStatus;
  }>({ pages: [], status: "loading" });

  const latestFetch = useRef(fetchPage);
  latestFetch.current = fetchPage;
  const request = useRef(0);
  const shown = useRef({ view, count: 1 });

  useEffect(() => {
    const id = ++request.current;
    const count = shown.current.view === view ? shown.current.count : 1;
    shown.current = { view, count };

    setState((current) => ({ ...current, status: "loading" }));

    void (async () => {
      const pages: Page[] = [];
      let cursor: string | undefined;

      while (pages.length < count) {
        const page = await latestFetch.current(cursor);

        if (request.current !== id) return;

        if (page === null) {
          setState((current) => ({ ...current, status: "error" }));

          return;
        }

        pages.push(page);
        const next = getNextCursor(page);

        if (next === null) break;
        cursor = next;
      }

      setState({ pages, status: "ready" });
    })();
  }, [view, revision, getNextCursor]);

  const last = state.pages.at(-1);
  const cursor = last === undefined ? null : getNextCursor(last);

  const loadMore = useCallback(() => {
    if (cursor === null || state.status !== "ready") return;

    const id = request.current;
    setState((current) => ({ ...current, status: "more" }));

    void latestFetch.current(cursor).then((page) => {
      if (request.current !== id) return;

      setState((current) => {
        if (page === null) return { ...current, status: "error" };

        shown.current = { view: shown.current.view, count: current.pages.length + 1 };

        return { pages: [...current.pages, page], status: "ready" };
      });
    });
  }, [cursor, state.status]);

  return {
    pages: state.pages,
    status: state.status,
    hasMore: cursor !== null,
    loadMore,
  };
}
