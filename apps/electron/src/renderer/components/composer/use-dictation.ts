/**
 * Dictation (v1's, ported): the mic is recorded in the browser and the whole take is transcribed by the server
 * when Done is pressed (`transcription:create`, docs/composer.md "Transcription (built)"); the text lands at the
 * cursor. Batch, not streaming: there is no interim text. Cancel (also while it is transcribing), leaving the page or unmounting drops the take.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@workspace/ui/components/sonner'

export const dictationSupported =
  typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

/** The toast for a failed transcription, by the server's error code. */
export function dictationErrorKey(code: unknown): string {
  switch (code) {
    case 'not_configured':
      return 'composer.error.notConfigured'
    case 'too_large':
      return 'composer.error.tooLong'
    default:
      return 'composer.error.unable'
  }
}

/** The bytes of a recording as base64 (chunked: one `String.fromCharCode` call per 32 KB). */
async function toBase64(audio: Blob): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function useDictation(onText: (text: string) => void) {
  const { t } = useTranslation()
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const discard = useRef(false)
  const deliver = useRef(onText)
  deliver.current = onText

  const start = async () => {
    if (!dictationSupported || recorder.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast.error(t('composer.error.micDenied'))
      return
    }
    const chunks: Blob[] = []
    const session = new MediaRecorder(stream)
    session.ondataavailable = (event) => chunks.push(event.data)
    session.onstop = async () => {
      for (const track of stream.getTracks()) track.stop()
      recorder.current = null
      setListening(false)
      if (discard.current) return
      setTranscribing(true)
      try {
        const audio = new Blob(chunks, { type: session.mimeType || 'audio/webm' })
        const { text } = await window.electronAPI.transcribe(await toBase64(audio), audio.type)
        // Cancel while it is being transcribed drops the text too.
        if (discard.current) return
        if (!text.trim()) toast.error(t('composer.error.noSpeech'))
        else deliver.current(text.trim())
      } catch (error) {
        if (discard.current) return
        const code = (error as { code?: unknown } | null)?.code
        toast.error(t(dictationErrorKey(code), { provider: 'OpenRouter' }))
      } finally {
        setTranscribing(false)
      }
    }
    discard.current = false
    recorder.current = session
    // Chunks arrive while recording, so a stop never depends on one final flush.
    session.start(250)
    setListening(true)
  }

  const stop = () => recorder.current?.stop()

  const cancel = () => {
    discard.current = true
    stop()
    setTranscribing(false)
  }

  // Unmounting releases the mic and drops the recording.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => cancel, [])

  return { supported: dictationSupported, listening, transcribing, start, stop, cancel }
}

/** Seconds since `on` turned true, as m:ss. */
export function useElapsed(on: boolean): string {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!on) return
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250)
    return () => clearInterval(timer)
  }, [on])
  return formatElapsed(seconds)
}

export function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
