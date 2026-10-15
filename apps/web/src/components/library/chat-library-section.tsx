import type { LibraryFile, ThreadId } from "@otto/contracts";
import { RiLockLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { DetailsGroup } from "../details-aside";
import { participantName } from "../work/work-participants";
import { LibraryItemMenu } from "./library-actions";
import { LibraryLightbox } from "./library-lightbox";
import { LibraryFileThumb } from "./library-visuals";
import { sortLibraryItems } from "./library.logic";
import { useLibraryData } from "./use-library";

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Otto: A chat's Library section in its details panel: the files saved from this chat, newest
 * first, as 40px rows with a thumbnail, title and who changed it when. Files arrive from the chat
 * itself (bots saving to the Library), never from an upload here, and a chat with none shows no
 * section at all.
 */
export function ChatLibrarySection({
  threadId,
  className,
}: {
  readonly threadId: ThreadId;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const { environmentId, folders, files } = data;
  const [preview, setPreview] = useState<LibraryFile | null>(null);
  const folder = folders.find((candidate) => candidate.threadId === threadId);

  const shown = folder
    ? sortLibraryItems(
        [],
        files.filter((file) => file.folderId === folder.id),
      ).files
    : [];

  const changedBy = (file: LibraryFile) =>
    participantName(file.updatedBy, data.participants.allBots);

  const open = (file: LibraryFile) =>
    file.type === "document"
      ? void navigate({ to: "/library/$fileId", params: { fileId: file.id } })
      : setPreview(file);

  if (shown.length === 0) return null;

  return (
    <div className={className}>
      <DetailsGroup id="chat-library" label={t("Library")} summary={String(shown.length)}>
        <ul className="-mx-2 flex flex-col">
          {shown.map((file) => (
            <li key={file.id} className="group relative">
              <button
                type="button"
                onClick={() => open(file)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {environmentId ? (
                  <LibraryFileThumb environmentId={environmentId} file={file} />
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col pe-7">
                  <span className="flex min-w-0 items-center gap-1.5 text-13px font-medium text-foreground">
                    <span className="truncate">{file.title}</span>
                    {file.visibility === "user" ? (
                      <RiLockLine
                        aria-label={t("Only me")}
                        className="size-3 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("{name} · {date}", {
                      name: changedBy(file),
                      date: shortDate.format(new Date(file.updatedAt)),
                    })}
                  </span>
                </span>
              </button>
              {environmentId ? (
                <div className="absolute top-1/2 right-1 -translate-y-1/2">
                  <LibraryItemMenu
                    environmentId={environmentId}
                    data={data}
                    target={{ kind: "file", file }}
                    revealInGroup
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {environmentId ? (
          <LibraryLightbox
            environmentId={environmentId}
            data={data}
            file={preview ? (files.find((file) => file.id === preview.id) ?? null) : null}
            siblings={shown.filter((file) => file.type !== "document")}
            onSelect={setPreview}
            onClose={() => setPreview(null)}
          />
        ) : null}
      </DetailsGroup>
    </div>
  );
}
