import type { EnvironmentId, LibraryFileId, OrchestrationProjectShell } from "@otto/contracts";
import { RiImageLine } from "@remixicon/react";
import { useEffect, useRef } from "react";

import { useTheme } from "../../hooks/use-theme";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { useLibraryFileUrl, useLibraryUpload } from "../library/use-library";
import { Button } from "../ui/button";
import { ditherPixels, grayCover } from "./work.logic";

/** Device pixels per dither cell: about one and a half CSS pixels, never under two device pixels. */
function cellSize() {
  return Math.max(2, Math.round(1.5 * window.devicePixelRatio));
}

/**
 * Otto: A project cover, 16:9 unless the caller sizes it: the uploaded image or a generated
 * gray card, both ordered-dithered on a canvas at one dot per cell and scaled up unsmoothed.
 */
export function ProjectCover({
  environmentId,
  project,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "id" | "coverFileId">;
  readonly className?: string;
}) {
  const { resolvedTheme } = useTheme();

  if (project.coverFileId) {
    return (
      <UploadedCover
        environmentId={environmentId}
        fileId={project.coverFileId}
        appearance={resolvedTheme}
        className={className}
      />
    );
  }

  return <DitheredCover appearance={resolvedTheme} imageUrl={null} className={className} />;
}

function UploadedCover({
  environmentId,
  fileId,
  appearance,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly fileId: LibraryFileId;
  readonly appearance: "light" | "dark";
  readonly className: string | undefined;
}) {
  const imageUrl = useLibraryFileUrl(environmentId, fileId);

  return <DitheredCover appearance={appearance} imageUrl={imageUrl} className={className} />;
}

/** Draws the dithered image, or the gray cover until there is one, whenever the size changes. */
function DitheredCover({
  appearance,
  imageUrl,
  className,
}: {
  readonly appearance: "light" | "dark";
  readonly imageUrl: string | null;
  readonly className: string | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context || typeof ResizeObserver === "undefined") return;

    const image = imageUrl ? new Image() : null;

    const draw = () => {
      const cell = cellSize();
      const width = Math.max(1, Math.round((canvas.clientWidth * window.devicePixelRatio) / cell));

      const height = Math.max(
        1,
        Math.round((canvas.clientHeight * window.devicePixelRatio) / cell),
      );

      canvas.width = width;
      canvas.height = height;

      if (!image?.complete || image.naturalWidth === 0) {
        const pixels = grayCover(width, height, appearance);
        context.putImageData(new ImageData(pixels, width, height), 0, 0);

        return;
      }

      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawnWidth = image.naturalWidth * scale;
      const drawnHeight = image.naturalHeight * scale;

      context.drawImage(
        image,
        (width - drawnWidth) / 2,
        (height - drawnHeight) / 2,
        drawnWidth,
        drawnHeight,
      );

      const frame = context.getImageData(0, 0, width, height);
      ditherPixels(frame.data, width);
      context.putImageData(frame, 0, 0);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);

    if (image && imageUrl) {
      image.crossOrigin = "anonymous";
      image.addEventListener("load", draw);
      image.src = imageUrl;
    }

    return () => {
      observer.disconnect();
      image?.removeEventListener("load", draw);
    };
  }, [appearance, imageUrl]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("project-cover-pixels block aspect-video w-full", className)}
    />
  );
}

/**
 * Otto: Change cover and Remove on a project page's cover, shown on hover or focus. Removing
 * goes back to the generated cover and keeps the image in the project's Library.
 */
export function ProjectCoverControls({
  environmentId,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: Pick<OrchestrationProjectShell, "id" | "coverFileId">;
}) {
  const { t } = useI18n();
  const { upload, uploading } = useLibraryUpload();
  const updateProject = useAtomCommand(projectEnvironment.update);
  const input = useRef<HTMLInputElement>(null);

  // Otto: The image goes into the project's Library folder, then becomes the cover.
  const setCover = async (file: File) => {
    const [coverFileId] = await upload(environmentId, [file], {
      folderId: null,
      projectId: project.id,
    });

    if (coverFileId) {
      await updateProject({ environmentId, input: { projectId: project.id, coverFileId } });
    }
  };

  return (
    <div className="absolute right-3 bottom-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const [file] = event.currentTarget.files ?? [];
          event.currentTarget.value = "";

          if (file) void setCover(file);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => input.current?.click()}
      >
        <RiImageLine aria-hidden />
        {t("Change cover")}
      </Button>
      {project.coverFileId ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void updateProject({
              environmentId,
              input: { projectId: project.id, coverFileId: null },
            })
          }
        >
          {t("Remove cover")}
        </Button>
      ) : null}
    </div>
  );
}
