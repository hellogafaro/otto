import { type EnvironmentId, type LibraryFile, librarySharePath } from "@otto/contracts";
import { squashAtomCommandFailure } from "@otto/client-runtime/state/runtime";
import * as Predicate from "effect/Predicate";
import { useState } from "react";
import { toast } from "sonner";

import { useCopyToClipboard } from "~/hooks/use-copy-to-clipboard";
import { resolveAssetUrl } from "../../assets/asset-urls";
import { useI18n } from "../../i18n";
import { libraryEnvironment } from "../../state/library";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { formatLibrarySize } from "./library.logic";
import { LIBRARY_TYPE_ICONS } from "./library-visuals";
import { useHttpBaseUrl } from "./use-library";

const sharedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Otto: A file's public link. Creating one freezes a copy of the file as it is now; once it
 * exists the dialog shows the link, Update link when the file changed since, and Remove link.
 */
export function LibraryShareDialog({
  open,
  onOpenChange,
  environmentId,
  file,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
        {open ? (
          <LibraryShareForm
            environmentId={environmentId}
            file={file}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function LibraryShareForm({
  environmentId,
  file,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const shareFile = useAtomCommand(libraryEnvironment.shareFile, { reportFailure: false });
  const unshareFile = useAtomCommand(libraryEnvironment.unshareFile, { reportFailure: false });
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({ target: "public link" });
  const httpBaseUrl = useHttpBaseUrl();
  const [pending, setPending] = useState<"share" | "unshare" | null>(null);
  const share = file.share;
  const Icon = LIBRARY_TYPE_ICONS[file.type];

  const url =
    share && httpBaseUrl.current !== null
      ? resolveAssetUrl(httpBaseUrl.current, librarySharePath(share.id))
      : null;

  const run = async (action: "share" | "unshare") => {
    setPending(action);
    const input = { environmentId, input: { fileId: file.id } };
    const result = await (action === "share" ? shareFile(input) : unshareFile(input));
    setPending(null);

    if (!Predicate.isTagged(result, "Failure")) return;

    const cause = squashAtomCommandFailure(result);
    const detail = cause instanceof Error ? cause.message : null;

    toast.error(
      action === "share"
        ? t("Public link couldn't be saved")
        : t("Public link couldn't be removed"),
      detail ? { description: detail } : undefined,
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("Share public link")}</DialogTitle>
        <DialogDescription>
          {share
            ? t("Anyone with the link can open the copy from {date}.", {
                date: sharedAtFormatter.format(new Date(share.sharedAt)),
              })
            : t("Anyone with the link can open this copy without signing in.")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        {share ? (
          <div className="flex gap-1.5">
            <Input readOnly aria-label={t("Public link")} value={url ?? ""} variant="mono" />
            <Button
              variant="outline"
              disabled={url === null}
              onClick={() => url !== null && copyToClipboard(url)}
            >
              {isCopied ? t("Copied") : t("Copy link")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 rounded-lg border border-border p-2.5">
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{file.title}</p>
                <p className="text-xs text-muted-foreground">{formatLibrarySize(file.sizeBytes)}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "The link shares the file as it is now. Later edits stay in Otto until you update the link.",
              )}
            </p>
          </>
        )}
      </DialogPanel>
      <DialogFooter>
        {share ? (
          <>
            <Button
              variant="ghost-destructive"
              className="sm:me-auto"
              disabled={pending !== null}
              onClick={() => void run("unshare")}
            >
              {pending === "unshare" ? <Spinner /> : null}
              {t("Remove link")}
            </Button>
            {file.updatedAt > share.sharedAt ? (
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => void run("share")}
              >
                {pending === "share" ? <Spinner /> : null}
                {t("Update link")}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose}>
              {t("Done")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button disabled={pending !== null} onClick={() => void run("share")}>
              {pending === "share" ? <Spinner /> : null}
              {t("Create link")}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
