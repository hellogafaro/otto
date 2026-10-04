import { ApiError } from "@/lib/api";

/** A cached draft may survive a transient read failure, never a denied read. */
export function canKeepDocumentDraft(error: Error) {
  return error instanceof ApiError
    ? error.status >= 500
    : error instanceof TypeError;
}

/** One document fence covers body, metadata, attachments and proposal acceptance. */
export async function runDocumentOperation(
  lock: { current: boolean },
  action: () => Promise<void>,
  onPendingChange: (pending: boolean) => void,
) {
  if (lock.current) throw new Error("Wait for the current document update.");
  lock.current = true;
  onPendingChange(true);
  try {
    await action();
  } finally {
    lock.current = false;
    onPendingChange(false);
  }
}
