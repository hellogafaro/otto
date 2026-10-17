import { useEffect, useRef, useState } from "react";

/**
 * Otto: The voice while dictating, from the pre-Akeru composer: 4px squarish bars 2px apart that
 * fill the row and follow the mic level mirrored from the center, then the elapsed time. The
 * speech range (up to ~6 kHz) spans the width, so a voice moves them edge to edge. They start
 * flat (a row of 4px dots) and stay flat without a stream, as while transcribing.
 */
export function DictationMeter({ stream }: { readonly stream: MediaStream | null }) {
  const bars = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const box = bars.current;

    if (!box) return;

    // Inside the 8px padding: n bars and n - 1 gaps.
    const observer = new ResizeObserver(() =>
      setCount(Math.max(0, Math.floor((box.clientWidth - 16 + 2) / 6))),
    );

    observer.observe(box);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!stream) return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);

    return () => clearInterval(timer);
  }, [stream]);

  useEffect(() => {
    if (!stream) return;
    let context: AudioContext | undefined;
    let frame = 0;

    try {
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      const levels = new Uint8Array(analyser.frequencyBinCount);

      const draw = () => {
        analyser.getByteFrequencyData(levels);
        const children = bars.current?.children ?? [];
        const half = children.length / 2;

        for (let index = 0; index < children.length; index++) {
          const fromCenter = Math.abs(index - half) / half;
          // Bins are 750 Hz wide (fftSize 64 at 48 kHz): 0-7 hold speech.
          const level = (levels[Math.floor(fromCenter * 7.99)] ?? 0) / 255;
          // SAFETY: the meter renders only span bars inside this box.
          (children[index] as HTMLElement).style.scale = `1 ${0.2 + level * 0.8}`;
        }

        frame = requestAnimationFrame(draw);
      };

      draw();
    } catch {
      void context?.close();

      return;
    }

    return () => {
      cancelAnimationFrame(frame);
      void context?.close();
    };
  }, [stream]);

  return (
    <>
      <div
        ref={bars}
        aria-hidden="true"
        className="flex h-5 min-w-0 flex-1 items-center gap-0.5 overflow-hidden px-2"
      >
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className="h-full w-1 shrink-0 scale-y-20 rounded-1px bg-muted-foreground transition-transform duration-75"
          />
        ))}
      </div>
      {stream ? (
        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      ) : null}
    </>
  );
}
