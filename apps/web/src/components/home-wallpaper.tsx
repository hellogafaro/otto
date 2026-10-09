import { useEffect, useRef, useState } from "react";
import { animatePhoto } from "@/components/home-photo";
import { useTheme } from "@/components/theme-provider";

export function HomeWallpaper() {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const photo = dark
    ? "/home-wallpaper/night-sky.avif"
    : "/home-wallpaper/clouds.avif";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setReady(false);
    let cancelled = false;
    let dispose = () => {};
    const image = new Image();
    image.src = photo;
    image.decode().then(
      () => {
        if (cancelled) return;
        dispose = animatePhoto(canvas, image);
        setReady(true);
      },
      () => {
        if (!cancelled) setReady(true);
      },
    );
    return () => {
      cancelled = true;
      dispose();
    };
  }, [photo]);

  return (
    <div
      aria-hidden="true"
      data-ready={ready || undefined}
      className="home-wallpaper"
      style={{ backgroundImage: `url(${photo})` }}
    >
      <canvas
        key={photo}
        ref={canvasRef}
        className="size-full [image-rendering:pixelated]"
      />
      <div className="home-wallpaper-scrim" />
    </div>
  );
}
