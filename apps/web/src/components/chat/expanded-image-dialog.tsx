import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiFileCopyLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiFolderOpenLine,
  RiCloseLine,
} from "@remixicon/react";
import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@otto/contracts";
import { memo, useCallback, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import { serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "../preview/file-explorer-label";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { copyExpandedImage, saveExpandedImage } from "./expanded-image-actions";
import type { ExpandedImageItem, ExpandedImagePreview } from "./expanded-image-preview";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
  /** Set for sent chat attachments so they can be revealed on the environment. */
  environmentId?: EnvironmentId;
}

/** Returns a reveal action when the environment can show a stored attachment in its file manager. */
function useRevealAttachment(environmentId: EnvironmentId | undefined) {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId ?? null));

  const revealAttachment = useAtomCommand(shellEnvironment.revealAttachment, {
    reportFailure: false,
  });

  if (
    environmentId === undefined ||
    serverConfig?.shellRevealInFileManager !== true ||
    !serverConfig.availableEditors.includes("file-manager")
  ) {
    return null;
  }

  const label =
    serverConfig.shellRevealInFileManagerKind === undefined
      ? revealInFileExplorerLabelForOs(serverConfig.environment.platform.os)
      : revealInFileExplorerLabelForKind(serverConfig.shellRevealInFileManagerKind);

  return {
    label,
    reveal: async (attachmentId: string) => {
      const result = await revealAttachment({ environmentId, input: { attachmentId } });

      if (Predicate.isTagged(result, "Failure"))
        throw new Error("The environment could not show the image.");
    },
  };
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
  environmentId,
}: ExpandedImageDialogProps) {
  const { t } = useI18n();
  const reveal = useRevealAttachment(environmentId);

  const runAction = useCallback((title: string, action: () => Promise<void>) => {
    action().catch(() => toast.error(title));
  }, []);

  const openImage = (item: ExpandedImageItem) =>
    window.open(item.src, "_blank", "noopener,noreferrer");

  const [imageOffset, setImageOffset] = useState(0);
  const index = (preview.index + imageOffset + preview.images.length) % preview.images.length;

  const navigateImage = useCallback((direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();

        return;
      }

      if (preview.images.length <= 1) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        navigateImage(-1);

        return;
      }

      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      navigateImage(1);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateImage, onClose, preview.images.length]);

  const item = preview.images[index];

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-shade/75 px-4 py-6 app-region-no-drag"
      role="dialog"
      aria-modal="true"
      aria-label={t("Expanded image preview")}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 cursor-zoom-out"
        aria-label={t("Close image preview")}
        onClick={onClose}
      />
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          presentation="image-nav"
          className="absolute left-2 top-1/2 z-20 -translate-y-1/2 sm:left-6"
          aria-label={t("Previous image")}
          onClick={() => navigateImage(-1)}
        >
          <RiArrowLeftSLine className="size-5" />
        </Button>
      )}
      <div className="relative isolate z-10 max-h-92vh max-w-92vw">
        <div className="absolute right-2 top-2 flex gap-1 rounded-md bg-background/80 p-0.5 shadow-sm">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => openImage(item)}
            aria-label={t("Open image")}
            title={t("Open image")}
          >
            <RiExternalLinkLine />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => runAction(t("Image couldn't be saved"), () => saveExpandedImage(item))}
            aria-label={t("Save image")}
            title={t("Save image")}
          >
            <RiDownloadLine />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() =>
              runAction(t("Image couldn't be copied"), async () => {
                await copyExpandedImage(item);
                toast.success(t("Image has been copied"));
              })
            }
            aria-label={t("Copy image")}
            title={t("Copy image")}
          >
            <RiFileCopyLine />
          </Button>
          {reveal ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                runAction(t("Image couldn't be revealed"), () => reveal.reveal(item.id))
              }
              aria-label={reveal.label}
              title={reveal.label}
            >
              <RiFolderOpenLine />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label={t("Close image preview")}
            title={t("Close image preview")}
          >
            <RiCloseLine />
          </Button>
        </div>
        <img
          src={item.src}
          alt={item.name}
          className="max-h-86vh max-w-92vw select-none rounded-lg border border-border/70 bg-background object-contain shadow-2xl"
          draggable={false}
        />
        <p className="mt-2 max-w-92vw truncate text-center text-xs text-muted-foreground/80">
          {item.name}
          {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
        </p>
      </div>
      {preview.images.length > 1 && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          presentation="image-nav"
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2 sm:right-6"
          aria-label={t("Next image")}
          onClick={() => navigateImage(1)}
        >
          <RiArrowRightSLine className="size-5" />
        </Button>
      )}
    </div>
  );
});
