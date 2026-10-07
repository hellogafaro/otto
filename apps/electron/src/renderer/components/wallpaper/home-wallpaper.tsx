/**
 * HomeWallpaper - Home's full-window photo (the sidebar included), dithered and slowly animated (`photo.ts`),
 * under one overlay (uniform, BB's bottom fade and a soft top-left scrim). Clouds in light, the night sky in dark. Mounted by the shell only
 * on Home (and its full list of notifications) and gone when you leave it (no canvas, no WebGL context elsewhere). While it shows it sets
 * `data-wallpaper` on <html>: the sidebar drops its fill and the page's surfaces turn to glass (globals.css, where
 * the scrim is styled too). It fades in once the photo is decoded. Photos: Viktor Mogilat and Raphael Koh on
 * Unsplash (see NOTICE).
 */

import { useEffect, useRef, useState } from 'react'
import clouds from '@/assets/wallpaper/clouds.avif'
import nightSky from '@/assets/wallpaper/night-sky.avif'
import { useTheme } from '@/context/theme-context'
import { animatePhoto } from './photo'

export function HomeWallpaper() {
  const { isDark } = useTheme()
  const photo = isDark ? nightSky : clouds
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.wallpaper = ''
    return () => {
      delete root.dataset.wallpaper
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    setReady(false)
    let dispose = () => {}
    let cancelled = false
    const image = new Image()
    image.src = photo
    image.decode().then(
      () => {
        if (cancelled) return
        dispose = animatePhoto(canvas, image)
        setReady(true)
      },
      () => {
        if (!cancelled) setReady(true)
      },
    )
    return () => {
      cancelled = true
      dispose()
    }
  }, [photo])

  return (
    <div
      aria-hidden
      data-ready={ready || undefined}
      className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-0 transition-opacity duration-240 ease-out data-ready:opacity-100 motion-reduce:transition-none"
      style={{ backgroundImage: `url(${photo})` }}
    >
      {/* A new canvas per photo: a released WebGL context cannot be taken again. */}
      <canvas key={photo} ref={canvasRef} className="size-full [image-rendering:pixelated]" />
      {/* The one overlay over the whole window: uniform, bottom fade, top-left scrim (globals.css, `--wallpaper-*`). */}
      <div data-slot="wallpaper-scrim" className="absolute inset-0" />
    </div>
  )
}
