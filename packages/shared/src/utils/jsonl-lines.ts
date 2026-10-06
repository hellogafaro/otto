/**
 * Line framing for JSONL over a pipe (the Pi agent subprocess protocol).
 *
 * Splits ONLY on "\n" (a trailing "\r" is dropped). Never use `node:readline` for this: it also
 * splits on U+2028 / U+2029, which are legal unescaped inside JSON strings, so a message that
 * contains one is cut in half. `JSON.stringify(x) + '\n'` is the matching, valid writer.
 */

/** A line longer than this (UTF-16 code units) is an error, never silently truncated. */
export const DEFAULT_MAX_LINE_LENGTH = 64 * 1024 * 1024;

export class LineTooLongError extends Error {
  constructor(maxLength: number) {
    super(`JSONL line exceeds ${maxLength} characters`);
    this.name = 'LineTooLongError';
  }
}

/**
 * Push chunks (bytes or strings, split anywhere, even inside a multi-byte character); complete
 * lines are passed to `onLine`. `end()` flushes a final line that has no trailing newline.
 * Throws `LineTooLongError` from `push` when one line grows past `maxLength`.
 */
export function createLineSplitter(onLine: (line: string) => void, maxLength = DEFAULT_MAX_LINE_LENGTH) {
  const decoder = new TextDecoder();
  let pending = '';

  const emit = (line: string) => onLine(line.endsWith('\r') ? line.slice(0, -1) : line);

  const feed = (text: string) => {
    let start = 0;
    for (let nl = text.indexOf('\n', start); nl !== -1; nl = text.indexOf('\n', start)) {
      const line = pending + text.slice(start, nl);
      pending = '';
      start = nl + 1;
      if (line.length > maxLength) throw new LineTooLongError(maxLength);
      emit(line);
    }
    pending += text.slice(start);
    if (pending.length > maxLength) {
      pending = '';
      throw new LineTooLongError(maxLength);
    }
  };

  return {
    push(chunk: Uint8Array | string): void {
      feed(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
    },
    end(): void {
      feed(decoder.decode());
      if (pending) {
        const line = pending;
        pending = '';
        emit(line);
      }
    },
  };
}

/**
 * Read lines from a stream until it ends. Returns a function that stops reading (the
 * replacement for `readline.close()`); `onEnd` is not called after it. A `LineTooLongError`
 * stops reading and goes to `onError`.
 */
export function readLines(
  stream: NodeJS.ReadableStream,
  handlers: { onLine: (line: string) => void; onEnd?: () => void; onError?: (error: Error) => void },
  maxLength?: number,
): () => void {
  const splitter = createLineSplitter(handlers.onLine, maxLength);
  const onData = (chunk: Uint8Array | string) => {
    try {
      splitter.push(chunk);
    } catch (error) {
      stop();
      handlers.onError?.(error as Error);
    }
  };
  const onEnd = () => {
    stop();
    splitter.end();
    handlers.onEnd?.();
  };
  const stop = () => {
    stream.off('data', onData);
    stream.off('end', onEnd);
  };
  stream.on('data', onData);
  stream.on('end', onEnd);
  return stop;
}
