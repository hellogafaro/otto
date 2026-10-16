import { Predicate } from "effect";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@otto/client-runtime/state/runtime";
import { toast } from "sonner";

export function downloadArchive(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): void {
  if (!Predicate.isTagged(result, "Failure") || isAtomCommandInterrupted(result)) return;
  toast.error(title);
}
