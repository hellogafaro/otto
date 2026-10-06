/**
 * The voice as bars filling the space (v1's, ported): 4px bars 2px apart, following the mic level mirrored from
 * the center. The speech range (up to ~6 kHz) spans the width, so a voice moves them edge to edge. They start
 * flat (a row of 4px dots) and stay flat until there is a level to show (or without mic access).
 */

import { useEffect, useRef, useState } from 'react'

export function Waveform() {
  const bars = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  useEffect(() => {
    const box = bars.current
    if (!box) return
    // Inside the 8px padding: n bars and n - 1 gaps.
    const observer = new ResizeObserver(() => setCount(Math.max(0, Math.floor((box.clientWidth - 16 + 2) / 6))))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    let frame = 0
    let stopped = false
    navigator.mediaDevices?.getUserMedia({ audio: true }).then(
      (granted) => {
        if (stopped) {
          for (const track of granted.getTracks()) track.stop()
          return
        }
        stream = granted
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 64
        context.createMediaStreamSource(granted).connect(analyser)
        const levels = new Uint8Array(analyser.frequencyBinCount)
        const draw = () => {
          analyser.getByteFrequencyData(levels)
          const children = bars.current?.children ?? []
          const half = children.length / 2
          for (let i = 0; i < children.length; i++) {
            const fromCenter = Math.abs(i - half) / half
            // Bins are 750 Hz wide (fftSize 64 at 48 kHz): 0-7 hold speech.
            const level = (levels[Math.floor(fromCenter * 7.99)] ?? 0) / 255
            ;(children[i] as HTMLElement).style.transform = `scaleY(${0.2 + level * 0.8})`
          }
          frame = requestAnimationFrame(draw)
        }
        draw()
      },
      () => {},
    )
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      for (const track of stream?.getTracks() ?? []) track.stop()
      void context?.close()
    }
  }, [])

  return (
    <div ref={bars} aria-hidden className="flex h-5 min-w-0 flex-1 items-center gap-0.5 overflow-hidden px-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="h-full w-1 shrink-0 rounded-full bg-muted-foreground transition-transform duration-75 motion-reduce:transition-none"
          style={{ transform: 'scaleY(0.2)' }}
        />
      ))}
    </div>
  )
}
