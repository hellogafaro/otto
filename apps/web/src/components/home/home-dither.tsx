import { useEffect, useRef } from "react";

import { bayerThreshold, hashSeed } from "../work/work.logic";
import { ditherDensity, ditherWaves } from "./home.logic";

/** CSS pixels per dither dot. */
const CELL = 2;

/** Frames per second; dither reads better stepping than gliding, and it stays cheap. */
const FPS = 12;

/** The page's text colour as RGB, whatever colour space the theme writes it in. */
function textColor(element: HTMLElement): readonly [number, number, number] {
  const probe = document.createElement("canvas").getContext("2d");

  if (!probe) return [0, 0, 0];

  probe.fillStyle = getComputedStyle(element).color;
  probe.fillRect(0, 0, 1, 1);

  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;

  return [red, green, blue];
}

/**
 * Otto: Home's backdrop, an ordered dither in the text colour at low strength, so it reads a
 * shade darker on light themes and lighter on dark ones. Its slow waves are seeded by the
 * person, so everyone gets their own pattern. It pauses while the tab is hidden and holds one
 * still frame for reduced motion.
 */
export function HomeDither({ seed }: { readonly seed: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) return;

    const waves = ditherWaves(hashSeed(seed));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    let last = 0;
    let image: ImageData | null = null;
    let color = textColor(canvas);

    const draw = (now: number) => {
      const width = Math.max(1, Math.round(canvas.clientWidth / CELL));
      const height = Math.max(1, Math.round(canvas.clientHeight / CELL));

      if (canvas.width !== width || canvas.height !== height || !image) {
        canvas.width = width;
        canvas.height = height;
        image = context.createImageData(width, height);
        color = textColor(canvas);
      }

      const seconds = (now - started) / 1000;
      const pixels = image.data;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          const on = ditherDensity(x / width, y / height, seconds, waves) > bayerThreshold(x, y);

          pixels[offset] = color[0];
          pixels[offset + 1] = color[1];
          pixels[offset + 2] = color[2];
          pixels[offset + 3] = on ? 24 : 0;
        }
      }

      context.putImageData(image, 0, 0);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);

      if (document.hidden || now - last < 1000 / FPS) return;

      last = now;
      draw(now);
    };

    if (still) draw(started);
    else frame = requestAnimationFrame(tick);

    const observer = new ResizeObserver(() => {
      image = null;

      if (still) draw(performance.now());
    });

    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [seed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="project-cover-pixels pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 w-full text-foreground"
    />
  );
}
