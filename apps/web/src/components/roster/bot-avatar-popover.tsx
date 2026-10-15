import { useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { AvatarColorPicker } from "./avatar-color-picker";
import { AVATAR_UPLOAD_MAX_FILE_BYTES, downscaleAvatarImage } from "./avatar-upload";
import { BotAvatarView } from "./bot-avatar-view";
import { BLOB_SHAPES, blobShapeLabel, resolveBlobRendering } from "./roster.logic";
import type { BotAvatar } from "./types";

type AvatarTab = "bot" | "upload";

/**
 * The avatar as its own picker: clicking it opens shapes and colors, or an
 * uploaded image. Every pick applies at once; there is nothing to save.
 */
export function BotAvatarPopover({
  value,
  name,
  onChange,
}: {
  readonly value: BotAvatar;
  readonly name: string;
  readonly onChange: (avatar: BotAvatar) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<AvatarTab>(value.kind === "image" ? "upload" : "bot");
  // The last shape and color stay picked while an upload is shown, so switching back restores them.
  const [blob, setBlob] = useState(() => resolveBlobRendering(value));
  const [failure, setFailure] = useState<"upload" | "too-large" | null>(null);
  const uploadSequence = useRef(0);

  const pickBlob = (next: typeof blob) => {
    setBlob(next);
    onChange({ kind: "blob", ...next });
  };

  const handleUpload = (file: File | undefined) => {
    if (!file) return;
    const sequence = ++uploadSequence.current;
    setFailure(null);

    if (file.size > AVATAR_UPLOAD_MAX_FILE_BYTES) {
      setFailure("too-large");

      return;
    }

    void downscaleAvatarImage(file).then(
      (assetPath) => {
        if (sequence === uploadSequence.current) {
          onChange({ kind: "image", assetPath, dithered: false });
        }
      },
      (cause: unknown) => {
        if (sequence !== uploadSequence.current) return;
        console.error("Could not read avatar image.", cause);
        setFailure("upload");
      },
    );
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="avatar-edit"
            size="avatar"
            aria-label={t("Change avatar")}
            data-testid="new-bot-avatar"
          />
        }
      >
        <BotAvatarView avatar={value} name={name} className="block size-12" />
      </PopoverTrigger>
      <PopoverPopup align="start" sideOffset={8} className="w-88">
        <div className="flex flex-col gap-3">
          <ToggleGroup
            aria-label={t("Avatar source")}
            variant="segmented"
            className="w-full *:flex-1"
            value={[tab]}
            onValueChange={(next) => {
              const picked = next[0];

              if (picked !== "bot" && picked !== "upload") return;
              setFailure(null);
              setTab(picked);

              if (picked === "bot") onChange({ kind: "blob", ...blob });
            }}
          >
            <Toggle value="bot">{t("Bot")}</Toggle>
            <Toggle value="upload">{t("Upload")}</Toggle>
          </ToggleGroup>
          {tab === "bot" ? (
            <>
              <div className="grid grid-cols-8 gap-0.5">
                {BLOB_SHAPES.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    aria-label={blobShapeLabel(shape, t)}
                    aria-pressed={blob.shape === shape}
                    data-bot-hover
                    onClick={() => pickBlob({ ...blob, shape })}
                    className={cn(
                      "flex aspect-square cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      blob.shape === shape ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <BotAvatarView
                      avatar={{ kind: "blob", shape, color: blob.color }}
                      name=""
                      className="size-6"
                    />
                  </button>
                ))}
              </div>
              <div className="border-t pt-3">
                <AvatarColorPicker
                  compact
                  value={blob.color}
                  onChange={(color) => pickBlob({ ...blob, color })}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-3">
              <label className="cursor-pointer text-sm font-medium text-foreground underline-offset-4 hover:underline">
                {value.kind === "image" ? t("Choose another image") : t("Choose image")}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => handleUpload(event.currentTarget.files?.[0])}
                />
              </label>
              {failure !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {failure === "too-large" ? t("Image too large") : t("Could not read image")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
