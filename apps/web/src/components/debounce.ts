import { useCallback, useEffect, useRef } from "react";

// Calls `fn` once things settle: `delay` ms after the last `run`, or at once
// on `flush` (on blur, and on unmount so leaving never drops a change). Only
// the last value is sent. Settings save through it; reuse it for any
// autosave.
export function useDebounced<T>(fn: (value: T) => void, delay = 800) {
  const latest = useRef(fn);
  latest.current = fn;
  const pending = useRef<{ value: T }>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    const { value } = pending.current;
    pending.current = undefined;
    latest.current(value);
  }, []);

  const run = useCallback(
    (value: T) => {
      pending.current = { value };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => flush, [flush]);
  return { run, flush };
}
