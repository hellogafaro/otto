import { useEffect } from "react";
import { create } from "zustand";

export type CreateKind = "task" | "project" | "routine" | "document" | "folder";

const useCreateRequestStore = create<{ readonly pending: CreateKind | null }>(() => ({
  pending: null,
}));

/**
 * Otto: Asks the page that makes this kind of thing to open its New flow, from the command
 * palette's Create group. The page answers once it is mounted and ready.
 */
export function requestCreate(kind: CreateKind): void {
  useCreateRequestStore.setState({ pending: kind });
}

/** Runs `open` once for a pending request of this kind, as soon as the page is ready. */
export function useCreateRequest(kind: CreateKind, ready: boolean, open: () => void): void {
  const pending = useCreateRequestStore((state) => state.pending);

  useEffect(() => {
    if (!ready || pending !== kind) return;
    useCreateRequestStore.setState({ pending: null });
    open();
  }, [kind, open, pending, ready]);
}
