import type { Ref } from "react";
import { Composer, type ComposerHandle } from "@/components/composer";

// The floating Ask Otto bar on tasks, projects, documents and the file
// viewer: a shortcut that starts a new chat with Otto about what is open.
// Page actions that Otto does (log time, a custom repeat) prefill it instead
// of a form. It is not the item's comments.
export function AskOtto({
  about,
  ref,
}: {
  /** What is open, e.g. "this task". */
  about: string;
  ref?: Ref<ComposerHandle>;
}) {
  // One line, kept small: 450px is the 728px page column divided by the
  // golden ratio. It centers under the content.
  return (
    <div className="mx-auto w-full max-w-[28.125rem]">
      <Composer
        compact
        ref={ref}
        placeholder={`Ask Otto about ${about}`}
        // Not wired yet: sending starts a new Otto chat with this page as
        // context.
        onSend={() => {}}
      />
    </div>
  );
}
