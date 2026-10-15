import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import { ditheredCover } from "./work.logic";

/** CSS pixels per dither cell, so the dot grid reads the same on a card and on a page. */
const COVER_CELL_PX = 2;

/**
 * Otto: A 16:9 project cover: the uploaded image, or a dithered gradient drawn from the
 * project id at one cell per two CSS pixels and scaled up without smoothing.
 */
export function ProjectCover({
  seed,
  imageUrl,
  className,
}: {
  readonly seed: string;
  readonly imageUrl?: string | null;
  readonly className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const width = Math.max(1, Math.round(canvas.clientWidth / COVER_CELL_PX));
      const height = Math.max(1, Math.round(canvas.clientHeight / COVER_CELL_PX));

      canvas.width = width;
      canvas.height = height;

      canvas
        .getContext("2d")
        ?.putImageData(new ImageData(ditheredCover(seed, width, height), width, height), 0, 0);
    });

    observer.observe(canvas);

    return () => observer.disconnect();
  }, [seed, imageUrl]);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        className={cn("block aspect-video w-full object-cover", className)}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block aspect-video w-full", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
