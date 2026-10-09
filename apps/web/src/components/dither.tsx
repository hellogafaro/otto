import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef } from "react";

// Ordered (Bayer 8×8) dithering in the image's own colors, four brightness
// steps. Drawn once per size, never animated. Every cell is the same whole
// number of device pixels (3 on a 2x screen, 2 on a 1x screen), so the dots
// stay square and even at any size.
const CELL = 1.5;
const STEPS = 4;
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
  14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];

const images = new Map<string, Promise<HTMLImageElement>>();

function load(src: string) {
  let image = images.get(src);
  if (!image) {
    const element = new Image();
    // Pixels are read back, so the image must allow CORS.
    element.crossOrigin = "anonymous";
    element.src = src;
    image = element.decode().then(() => element);
    image.catch(() => images.delete(src));
    images.set(src, image);
  }
  return image;
}

function dither(
  box: HTMLElement,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
) {
  const ratio = window.devicePixelRatio || 1;
  const cell = Math.max(1, Math.round(CELL * ratio));
  // Whole cells covering the box; the canvas overhangs by under one cell and
  // the box clips it.
  const width = Math.max(1, Math.ceil((box.clientWidth * ratio) / cell));
  const height = Math.max(1, Math.ceil((box.clientHeight * ratio) / cell));
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${(width * cell) / ratio}px`;
  canvas.style.height = `${(height * cell) / ratio}px`;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;

  // Cover fit, centered.
  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(
    image,
    (image.naturalWidth - sourceWidth) / 2,
    (image.naturalHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );

  const pixels = context.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum =
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const threshold = BAYER[(y % 8) * 8 + (x % 8)] / 64 - 0.5;
      const brightness = Math.min(1, Math.max(0, lum + threshold / STEPS));
      const level = Math.floor(brightness * STEPS + 0.5) / STEPS;
      const gain = level / Math.max(lum, 0.001);
      data[i] *= gain;
      data[i + 1] *= gain;
      data[i + 2] *= gain;
    }
  }
  context.putImageData(pixels, 0, 0);
}

// An image box filled with the dithered picture; it fades in once drawn and
// redraws when its size changes.
export function Dither({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = ref.current;
    if (!box || !canvas) return;
    let cancelled = false;
    let timer = 0;
    const draw = () =>
      load(src).then(
        (image) => {
          if (cancelled) return;
          dither(box, canvas, image);
          canvas.dataset.ready = "";
        },
        () => {},
      );
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(draw, 100);
    });
    observer.observe(box);
    draw();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [src]);

  return (
    <div
      ref={boxRef}
      aria-hidden
      className={cn("relative overflow-hidden", className)}
    >
      <canvas
        ref={ref}
        className="absolute top-0 left-0 opacity-0 transition-opacity duration-200 [image-rendering:pixelated] data-ready:opacity-100 motion-reduce:transition-none"
      />
    </div>
  );
}

// A page's cover: the dithered picture as a 4:1 banner above the title, with
// the gallery tile's corners and ring.
export function Cover({ src }: { src: string }) {
  return (
    <Dither
      src={src}
      className="aspect-[4/1] rounded-md ring-1 ring-foreground/10"
    />
  );
}
