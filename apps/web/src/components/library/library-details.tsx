import {
  type EnvironmentId,
  type LibraryFile,
  type LibraryFileType,
  libraryFolderPath,
} from "@otto/contracts";
import { RiBookShelfLine, RiFolderLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";

import { useI18n } from "../../i18n";
import { DetailsGroup, DetailsRow } from "../details-aside";
import { ParticipantAvatar, participantName } from "../work/work-participants";
import { LibraryVisibilitySelect, useLibraryItemActions } from "./library-actions";
import { formatLibrarySize } from "./library.logic";
import { LIBRARY_TYPE_ICONS } from "./library-visuals";
import type { LibraryData } from "./use-library";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function useLibraryTypeLabel() {
  const { t } = useI18n();

  const labels = {
    document: t("Document"),
    image: t("Image"),
    pdf: t("PDF"),
    file: t("File"),
  } satisfies Record<LibraryFileType, string>;

  return (type: LibraryFileType) => labels[type];
}

/**
 * A file's Details tab: what it is, where it lives, who sees it, and who made and last
 * changed it. Only the creator changes its visibility.
 */
export function LibraryFileDetails({
  environmentId,
  data,
  file,
  onNavigate,
}: {
  readonly environmentId: EnvironmentId;
  readonly data: LibraryData;
  readonly file: LibraryFile;
  /** Called before following the folder link, so an overlay can close. */
  readonly onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const typeLabels = useLibraryTypeLabel();
  const actions = useLibraryItemActions(environmentId, data, { kind: "file", file });
  const folder = libraryFolderPath(data.folders, file.folderId)[0];
  const TypeIcon = LIBRARY_TYPE_ICONS[file.type];
  const bots = data.participants.allBots;

  const person = (participant: LibraryFile["createdBy"]) => (
    <span className="flex min-w-0 items-center gap-1.5 px-2.5 text-sm text-foreground">
      <ParticipantAvatar participant={participant} bots={bots} className="size-4" />
      <span className="truncate">{participantName(participant, bots)}</span>
    </span>
  );

  return (
    <>
      <DetailsGroup id="library-file-properties" label={t("Properties")}>
        <DetailsRow label={t("Type")}>
          <span className="flex items-center gap-1.5 px-2.5 text-sm text-foreground">
            <TypeIcon aria-hidden className="size-3.5 text-muted-foreground" />
            {typeLabels(file.type)}
            {file.extension ? (
              <span className="text-muted-foreground">.{file.extension}</span>
            ) : null}
          </span>
        </DetailsRow>
        <DetailsRow label={t("Size")}>
          <span className="px-2.5 text-sm text-foreground">
            {formatLibrarySize(file.sizeBytes)}
          </span>
        </DetailsRow>
        <DetailsRow label={t("Folder")}>
          <Link
            to="/library"
            search={folder ? { folder: folder.id } : {}}
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-foreground hover:bg-secondary"
          >
            {folder ? (
              <RiFolderLine aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <RiBookShelfLine aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{folder?.title ?? t("Library")}</span>
          </Link>
        </DetailsRow>
        <DetailsRow label={t("Visibility")}>
          <LibraryVisibilitySelect
            value={file.visibility}
            editable={data.canEdit(file)}
            onChange={actions.setVisibility}
          />
        </DetailsRow>
      </DetailsGroup>
      <DetailsGroup id="library-file-activity" label={t("Activity")}>
        <DetailsRow label={t("Created by")}>{person(file.createdBy)}</DetailsRow>
        <DetailsRow label={t("Created")}>
          <span className="px-2.5 text-sm text-foreground">
            {dateFormatter.format(new Date(file.createdAt))}
          </span>
        </DetailsRow>
        <DetailsRow label={t("Updated by")}>{person(file.updatedBy)}</DetailsRow>
        <DetailsRow label={t("Updated")}>
          <span className="px-2.5 text-sm text-foreground">
            {dateFormatter.format(new Date(file.updatedAt))}
          </span>
        </DetailsRow>
      </DetailsGroup>
      {actions.dialogs}
    </>
  );
}
