import { Debouncer } from "@tanstack/react-pacer";
import { useEffect, useRef, useState } from "react";

/** Otto: How long an edit waits for the next one before a form saves it. */
export const AUTOSAVE_WAIT_MS = 800;

/**
 * Otto: Saving without a Save button. `schedule` after each edit saves 800ms after the last
 * one, `flush` saves now (when focus leaves the form), and leaving the page saves whatever is
 * still waiting. `save` should do nothing when there is nothing to save.
 */
export function useAutosave(save: () => void) {
  const latestSave = useRef(save);

  useEffect(() => {
    latestSave.current = save;
  });

  const [debouncer] = useState(
    () => new Debouncer(() => latestSave.current(), { wait: AUTOSAVE_WAIT_MS }),
  );

  useEffect(() => () => debouncer.flush(), [debouncer]);

  return {
    schedule: () => debouncer.maybeExecute(),
    flush: () => {
      debouncer.cancel();
      save();
    },
  };
}
