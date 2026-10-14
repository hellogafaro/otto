import type { LibraryFile, ThreadId } from "@otto/contracts";
import { RiBookShelfLine, RiListCheck, RiLockLine, RiUploadLine } from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useI18n } from "../../i18n";
import type { DetailsTab } from "../DetailsAside";
import { Button } from "../ui/button";
import { participantName } from "../work/WorkParticipants";
import { LibraryItemMenu } from "./LibraryActions";
import { LibraryLightbox } from "./LibraryLightbox";
import { LibraryFileThumb } from "./LibraryVisuals";
import { sortLibraryItems } from "./library.logic";
import { useLibraryData, useLibraryUpload } from "./useLibrary";

export type ChatSidebarTab = "details" | "library";

/** Details then Library, the tabs every chat's right sidebar shows. */
export function useChatSidebarTabs(): ReadonlyArray<DetailsTab<ChatSidebarTab>> {
  const { t } = useI18n();

  return [
    { value: "details", label: t("Details"), icon: RiListCheck },
    { value: "library", label: t("Library"), icon: RiBookShelfLine },
  ];
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Otto: A chat's Library tab: the files saved from this chat, newest first,
 * as 40px rows with a thumbnail, title and who changed it when. Upload saves
 * into the chat's folder, made under Chats on first save; the footer link opens
 * that folder in the Library. A chat that hasn't started has nothing to save to.
 */
export function ChatLibraryPanel({ threadId }: { readonly threadId: ThreadId | null }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const { environmentId, folders, files } = data;
  const { upload, uploading } = useLibraryUpload();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LibraryFile | null>(null);

  const folder = threadId
    ? folders.find((candidate) => candidate.threadId === threadId)
    : undefined;

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

  return (
    <div className="flex flex-col gap-3 px-3 pt-1 pb-6">
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const chosen = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";

          if (environmentId && threadId && chosen.length > 0) {
            void upload(environmentId, chosen, { folderId: null, threadId });
          }
        }}
      />
      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-1 px-2 pt-2">
          <p className="text-sm font-medium text-foreground">{t("No files")}</p>
          <p className="text-13px text-muted-foreground">
            {threadId
              ? t("Files saved from this chat appear here.")
              : t("Send a message first; files saved from this chat appear here.")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
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
      )}
      <div className="flex items-center justify-between gap-2 px-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!environmentId || !threadId || uploading}
          onClick={() => fileInput.current?.click()}
        >
          <RiUploadLine />
          {t("Upload files")}
        </Button>
        {folder ? (
          <Link
            to="/library"
            search={{ folder: folder.id }}
            className="text-13px text-muted-foreground hover:text-foreground"
          >
            {t("Open in Library")}
          </Link>
        ) : null}
      </div>
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
    </div>
  );
}
