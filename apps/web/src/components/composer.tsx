import {
  RiAddLine,
  RiArrowUpLine,
  RiCheckLine,
  RiCloseLine,
  RiMicLine,
  RiStopFill,
} from "@remixicon/react";
import { Placeholder } from "@tiptap/extensions";
import {
  type Editor,
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@workspace/ui/components/attachment";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@workspace/ui/components/input-group";
import { toast } from "@workspace/ui/components/sonner";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createMentions,
  mentionKey,
  toContent,
  toText,
} from "@/components/mentions";
import { resourceIcons, resourceKindOf } from "@/components/task-meta";
import { useWorkspace } from "@/lib/workspace";
import "@/components/editor/editor.css";

export type FileRef = {
  id: string;
  name: string;
  type: string;
  size: number;
  // Object URL for local files; a stored file URL once uploads exist.
  url: string;
};

type Pending = FileRef & {
  state: "uploading" | "error" | "done";
  requestId: string;
  source: File;
  error?: string;
};

// Text uses the stored form, with tags as @[label](type:id).
export type ComposerHandle = {
  /** Replace the text and put the cursor at the end. */
  prefill: (text: string) => void;
  /** Insert text at the start (e.g. a reply's @tag). */
  prepend: (text: string) => void;
};

// Enter sends; Shift+Enter adds a line. It runs before the editor's own Enter
// (new paragraph) and steps aside while the "@" palette is open.
const SendOnEnter = Extension.create<{ onEnter: () => void }>({
  name: "sendOnEnter",
  priority: 1000,
  addOptions() {
    return { onEnter: () => {} };
  },
  addKeyboardShortcuts() {
    const enter = () => {
      if (mentionKey.getState(this.editor.state)?.active) return false;
      this.options.onEnter();
      return true;
    };
    return { Enter: enter, "Mod-Enter": enter };
  },
});

// The one composer for comments, chats and agent requests: text, "@" tags and
// files. + adds files (also by dropping or pasting them). The main button
// dictates while the box is empty, sends once there is text or a file, and
// stops a reply while `busy`. `tools` sit next to + (model or agent pickers).
// Upload callbacks save real bytes before a message can reference them. `compact` is the one-line
// floating bar (the floating chat): + on the left, the main button on the
// right. `embedded` is the smaller composer inside a 12px card (the floating
// chat's window): 4px in, so 8px corners; its 28px buttons 6px in with the
// 28px buttons' 6px corners, so they breathe and stay round; text 12px in
// (16px from the card, like the panel's text), on the + icon's line; one
// step lighter than the card it sits on. `idle` sits before the main button
// only while the box is empty (no text or files).
export function Composer({
  onSend,
  placeholder,
  tools,
  idle,
  busy = false,
  onStop,
  compact = false,
  embedded = false,
  disabled = false,
  sendable = true,
  pending = false,
  upload,
  projectId,
  ref,
}: {
  onSend: (text: string, files: FileRef[]) => unknown;
  placeholder: string;
  tools?: ReactNode;
  idle?: ReactNode;
  busy?: boolean;
  onStop?: () => void;
  compact?: boolean;
  embedded?: boolean;
  disabled?: boolean;
  /** False keeps Send disabled while the text stays editable (a form around the composer is incomplete). */
  sendable?: boolean;
  pending?: boolean;
  projectId?: string;
  upload?: (
    file: File,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<FileRef>;
  ref?: Ref<ComposerHandle>;
}) {
  const { workspaceId } = useWorkspace();
  const mentionScope = useRef(projectId);
  mentionScope.current = projectId;
  const mentions = useMemo(
    () => createMentions(workspaceId, () => mentionScope.current),
    [workspaceId],
  );
  // The embedded composer's buttons: 28px, 6px corners.
  const button = embedded
    ? ({ size: "icon-sm", className: "size-7 rounded-sm" } as const)
    : ({ size: "icon-sm" } as const);
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const transfers = useRef(new Map<string, AbortController>());
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () => {
      for (const transfer of transfers.current.values()) transfer.abort();
      for (const file of filesRef.current)
        if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url);
    },
    [],
  );
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Latest handlers for the editor's key and paste hooks.
  const actions = useRef({ send: () => {}, add: (_: FileList) => {} });

  // Read live, so a changed placeholder (a new chat's members) shows at once.
  const placeholderText = useRef(placeholder);
  placeholderText.current = placeholder;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        // The compact bar is one line: no Shift+Enter breaks.
        hardBreak: compact ? false : undefined,
      }),
      Placeholder.configure({ placeholder: () => placeholderText.current }),
      mentions,
      SendOnEnter.configure({ onEnter: () => actions.current.send() }),
    ],
    editorProps: {
      // One line tall until it grows with the text, up to 240px. The
      // compact bar stays one line and scrolls sideways as you type.
      attributes: {
        class: compact
          ? "otto-composer no-scrollbar overflow-x-auto overflow-y-hidden p-1 text-sm whitespace-pre! outline-none"
          : cn(
              "otto-composer max-h-60 overflow-y-auto p-3 pb-0 text-sm outline-none",
            ),
        "aria-label": placeholder,
      },
      // Pasted lines join into one in the compact bar.
      transformPastedText: (text) =>
        compact ? text.replace(/\s*\n\s*/g, " ") : text,
      handlePaste: (_view, event) => {
        const pasted = event.clipboardData?.files;
        if (!pasted?.length) return false;
        actions.current.add(pasted);
        return true;
      },
      handleDrop: (_view, event) => {
        const dropped = (event as DragEvent).dataTransfer?.files;
        if (!dropped?.length) return false;
        actions.current.add(dropped);
        return true;
      },
    },
  });
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("aria-label", placeholder);
    // An empty transaction redraws the placeholder.
    editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);
  const empty = useEditorState({
    editor,
    selector: ({ editor }) => editor?.isEmpty ?? true,
  });
  const dictation = useDictation(editor);
  useEffect(() => {
    editor?.setEditable(!disabled && !pending && !sending);
  }, [editor, disabled, pending, sending]);
  const elapsed = useElapsed(dictation.listening);
  const uploading = files.some((file) => file.state !== "done");
  const hasContent = !empty || files.length > 0;
  const canSend =
    sendable &&
    hasContent &&
    !uploading &&
    !busy &&
    !disabled &&
    !pending &&
    !sending &&
    !dictation.listening &&
    !dictation.transcribing;

  useImperativeHandle(ref, () => ({
    prefill: (text) => {
      editor?.chain().setContent(toContent(text)).focus("end").run();
    },
    prepend: (text) => {
      if (!editor) return;
      if (editor.isEmpty) {
        editor.chain().setContent(toContent(text)).focus("end").run();
        return;
      }
      const [first] = toContent(text).content ?? [];
      editor
        .chain()
        .insertContentAt(1, first?.content ?? [])
        .focus("end")
        .run();
    },
  }));

  const add = (list: FileList | File[]) => {
    if (disabled || pending || sending) return;
    if (!upload) {
      toast.error("Attachments are unavailable here");
      return;
    }
    const added = [...list].map((file) => ({
      id: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      source: file,
      name: file.name,
      type: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
      state: "uploading" as const,
    }));
    setFiles((current) => [...current, ...added]);
    for (const file of added) void transfer(file);
  };

  const transfer = async (file: Pending) => {
    if (!upload) return;
    const controller = new AbortController();
    transfers.current.set(file.requestId, controller);
    setFiles((current) =>
      current.map((item) =>
        item.requestId === file.requestId
          ? { ...item, state: "uploading", error: undefined }
          : item,
      ),
    );
    try {
      const saved = await upload(
        file.source,
        file.requestId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setFiles((current) =>
        current.map((item) =>
          item.requestId === file.requestId
            ? { ...item, ...saved, state: "done" }
            : item,
        ),
      );
      if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof Error
          ? error.message
          : "Upload failed. Retry with the same file.";
      setFiles((current) =>
        current.map((item) =>
          item.requestId === file.requestId
            ? { ...item, state: "error", error: message }
            : item,
        ),
      );
    } finally {
      transfers.current.delete(file.requestId);
    }
  };

  const remove = (id: string) =>
    setFiles((current) => {
      const file = current.find((candidate) => candidate.id === id);
      if (file) {
        transfers.current.get(file.requestId)?.abort();
        if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url);
      }
      return current.filter((candidate) => candidate.id !== id);
    });

  const send = async () => {
    if (!canSend || !editor || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend(
        toText(editor.getJSON()).trim(),
        files.map(({ id, name, type, size, url }) => ({
          id,
          name,
          type,
          size,
          url,
        })),
      );
      editor.commands.clearContent(true);
      for (const file of files)
        if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url);
      setFiles([]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to send, your draft is kept",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  actions.current = { send, add };

  // One main action, in priority order.
  const main =
    sending || pending ? (
      <MainButton {...button} label="Sending" disabled>
        <Spinner />
      </MainButton>
    ) : busy ? (
      <MainButton {...button} label="Stop" onClick={onStop}>
        <RiStopFill />
      </MainButton>
    ) : dictation.transcribing ? (
      <MainButton {...button} label="Transcribing" disabled>
        <Spinner />
      </MainButton>
    ) : dictation.listening ? (
      <MainButton {...button} label="Done" onClick={dictation.stop}>
        <RiCheckLine />
      </MainButton>
    ) : hasContent ? (
      <MainButton {...button} label="Send" type="submit" disabled={!canSend}>
        <RiArrowUpLine />
      </MainButton>
    ) : (
      <MainButton
        {...button}
        label={dictation.supported ? "Dictate" : "Dictation isn't available"}
        disabled={!dictation.supported || disabled}
        onClick={dictation.start}
      >
        <RiMicLine />
      </MainButton>
    );

  // While dictating: Cancel (takes the dictated text back), the waveform and
  // the time; the main button turns into Done (keeps the text).
  const listening = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <InputGroupButton
              {...button}
              aria-label="Cancel dictation"
              onClick={dictation.cancel}
            />
          }
        >
          <RiCloseLine />
        </TooltipTrigger>
        <TooltipContent>Cancel</TooltipContent>
      </Tooltip>
      <Waveform />
      <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {elapsed}
      </span>
    </>
  );

  const attachments = files.length > 0 && (
    // Attachments sit 4px in (top and sides), like the buttons below, so
    // their 8px corners nest in the composer's 12px (8 + 4). AttachmentGroup
    // adds the 4px above. In the compact bar nothing pads below them: the
    // row's own 4px is the gap.
    <InputGroupAddon
      align="block-start"
      className={cn("px-1 pt-0", compact && "pb-0")}
    >
      <AttachmentGroup className={cn("w-full", compact && "pb-0")}>
        {files.map((file) => (
          <div key={file.requestId} className="flex flex-col gap-1">
            <FileAttachment
              key={file.id}
              file={file}
              state={file.state}
              compact={compact || embedded}
              nested={embedded}
              onRemove={sending ? undefined : () => remove(file.id)}
            />
            {file.state === "error" && (
              <>
                <p role="alert">{file.error}</p>
                <InputGroupButton onClick={() => void transfer(file)}>
                  Retry upload
                </InputGroupButton>
              </>
            )}
          </div>
        ))}
      </AttachmentGroup>
    </InputGroupAddon>
  );

  const plus = (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            {...button}
            aria-label="Add files"
            disabled={!upload || disabled || pending || sending}
            onClick={() => picker.current?.click()}
          />
        }
      >
        <RiAddLine />
      </TooltipTrigger>
      <TooltipContent>Add files</TooltipContent>
    </Tooltip>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {/* Same surface as a comment card (xl radius, card background, faint
          ring). Two insets: visible edges (attachment borders, button
          backgrounds) sit 4px in, so their 8px corners nest in its 12px;
          content (text) sits 16px in. The
          compact bar keeps the corners and floats (shadow-md). */}
      <InputGroup
        data-dragging={dragging}
        className={cn(
          "border-0 bg-card ring-1 ring-foreground/10 data-[dragging=true]:ring-ring dark:bg-card",
          embedded
            ? // The hairline inside, so its visible edge sits 4px in, where
              // the top bar's buttons sit.
              "rounded-md shadow-none ring-inset dark:bg-muted/50"
            : cn(
                "rounded-xl",
                compact
                  ? // Floats on the command palette's surface: dark,
                    // translucent, blurred.
                    "dark h-auto bg-popover/70 text-popover-foreground shadow-md backdrop-blur-2xl backdrop-saturate-150 dark:bg-popover/70"
                  : "shadow-xs",
              ),
        )}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false);
          // The editor already took drops on the text.
          if (event.defaultPrevented) return;
          event.preventDefault();
          add(event.dataTransfer.files);
        }}
      >
        {attachments}
        {compact ? (
          // One row, 40px like a top bar: buttons 4px from the edges, text
          // 44px in (4px padding + 32px button + 4px gap + 4px text padding).
          <div className="flex w-full items-center gap-1 p-1">
            {dictation.listening ? listening : plus}
            {/* Kept mounted while dictating (the text lands here), but the
                bar shows the waveform instead. */}
            <EditorContent
              editor={editor}
              className={cn("min-w-0 flex-1", dictation.listening && "hidden")}
            />
            {!dictation.listening && tools}
            {!dictation.listening && !hasContent && idle}
            {main}
          </div>
        ) : (
          <>
            <EditorContent editor={editor} className="w-full" />
            <InputGroupAddon
              align="block-end"
              className={embedded ? "p-1.5" : "p-1"}
            >
              {dictation.listening ? (
                listening
              ) : (
                <>
                  {plus}
                  {tools}
                </>
              )}
              <span className="ml-auto">{main}</span>
            </InputGroupAddon>
          </>
        )}
      </InputGroup>
      {/* Outside the group: a direct <input> child changes its addon padding. */}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) add(event.target.files);
          event.target.value = "";
        }}
      />
    </form>
  );
}

function MainButton({
  label,
  children,
  ...props
}: { label: string } & ComponentProps<typeof InputGroupButton>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            variant="default"
            size="icon-sm"
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Dictation: the mic is recorded in the browser and transcribed by the server
// when Done is pressed; the text is typed in at the cursor.
const supported =
  typeof MediaRecorder !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

const dictationErrors: Record<string, string> = {
  not_configured: "Dictation isn't set up",
  timeout: "Unable to transcribe",
  unavailable: "Unable to transcribe",
  too_large: "The recording is too long to transcribe",
};

async function transcribe(audio: Blob) {
  const response = await fetch("/api/transcriptions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
  });
  const body: { text?: string; error?: string } = await response
    .json()
    .catch(() => ({}));
  if (!response.ok || typeof body.text !== "string")
    throw new Error(
      dictationErrors[body.error ?? ""] ?? "Unable to transcribe",
    );
  return body.text.trim();
}

function useDictation(editor: Editor | null) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);

  const start = async () => {
    if (!supported || !editor || recorder.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Allow microphone access to dictate");
      return;
    }
    // Opens the provider connection while the user speaks.
    void fetch("/api/transcriptions/warmup", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    const chunks: Blob[] = [];
    const session = new MediaRecorder(stream);
    session.ondataavailable = (event) => chunks.push(event.data);
    session.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      setListening(false);
      if (discard.current) return;
      setTranscribing(true);
      try {
        const text = await transcribe(
          new Blob(chunks, { type: session.mimeType }),
        );
        if (text) {
          const at = editor.state.selection.to;
          const before = editor.state.doc.textBetween(Math.max(0, at - 1), at);
          editor
            .chain()
            .focus()
            .insertContent((before && before !== " " ? " " : "") + text)
            .run();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to transcribe",
        );
      } finally {
        setTranscribing(false);
      }
    };
    discard.current = false;
    recorder.current = session;
    session.start();
    setListening(true);
  };

  const stop = () => recorder.current?.stop();

  const cancel = () => {
    discard.current = true;
    stop();
  };

  // Leaving the page releases the mic and drops the recording.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only
  useEffect(() => cancel, []);

  return { supported, listening, transcribing, start, stop, cancel };
}

// Seconds since `on` turned true, as m:ss.
function useElapsed(on: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!on) return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [on]);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// The voice as bars filling the space (4px bars, 2px apart), following the
// mic level mirrored from the center. The speech range (up to ~6 kHz) spans
// the width, so a voice moves them edge to edge. They start flat (a row of
// 4px dots) and stay flat until there is a level to show (or without mic
// access).
function Waveform() {
  const bars = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const box = bars.current;
    if (!box) return;
    const observer = new ResizeObserver(() =>
      // Inside the 8px padding: n bars and n - 1 gaps.
      setCount(Math.floor((box.clientWidth - 16 + 2) / 6)),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;
    let stopped = false;
    navigator.mediaDevices?.getUserMedia({ audio: true }).then(
      (granted) => {
        if (stopped) {
          for (const track of granted.getTracks()) track.stop();
          return;
        }
        stream = granted;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 64;
        context.createMediaStreamSource(granted).connect(analyser);
        const levels = new Uint8Array(analyser.frequencyBinCount);
        const draw = () => {
          analyser.getByteFrequencyData(levels);
          const children = bars.current?.children ?? [];
          const half = children.length / 2;
          for (let i = 0; i < children.length; i++) {
            const fromCenter = Math.abs(i - half) / half;
            // Bins are 750 Hz wide (fftSize 64 at 48 kHz): 0-7 hold speech.
            const level = levels[Math.floor(fromCenter * 7.99)] / 255;
            (children[i] as HTMLElement).style.transform =
              `scaleY(${0.2 + level * 0.8})`;
          }
          frame = requestAnimationFrame(draw);
        };
        draw();
      },
      () => {},
    );
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      for (const track of stream?.getTracks() ?? []) track.stop();
      context?.close();
    };
  }, []);

  return (
    <div
      ref={bars}
      aria-hidden
      className="flex h-5 min-w-0 flex-1 items-center gap-0.5 overflow-hidden px-2"
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed, ordered bars.
          key={i}
          className="h-full w-1 shrink-0 rounded-full bg-muted-foreground transition-transform duration-75"
          style={{ transform: "scaleY(0.2)" }}
        />
      ))}
    </div>
  );
}

// "PNG", "MD", "PDF": the extension, else the MIME subtype.
function fileKind({ name, type }: FileRef) {
  const extension = name.includes(".") ? name.split(".").pop() : "";
  return (extension || type.split("/")[1] || "file").toUpperCase();
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// One file, pending in the composer (removable) or sent (opens the resource
// viewer, the same overlay as everywhere else).
export function FileAttachment({
  file,
  state = "done",
  compact = false,
  nested = false,
  onRemove,
  onOpen,
}: {
  file: FileRef;
  state?: "uploading" | "error" | "done";
  /** The compact bar's chip: 28px, its thumbnail and name. */
  compact?: boolean;
  /** The chip inside the embedded composer's 8px corners: 4px corners,
   * its thumbnail 2px. */
  nested?: boolean;
  onRemove?: () => void;
  onOpen?: () => void;
}) {
  const Icon = resourceIcons[resourceKindOf(file.type)];
  const image = file.type.startsWith("image/");
  if (compact)
    // 28px like the compact buttons: a 20px thumbnail 4px in (4px corners
    // inside its 8px, which sit 4px inside the bar's 12px), the name cut in
    // the middle so its end and type stay, and a 20px remove.
    return (
      <Attachment
        size="xs"
        state={state}
        // 3px + the 1px border puts the thumbnail 4px in: 28px in all.
        className={cn(
          "min-w-0 gap-1.5 text-xs has-data-[slot=attachment-media]:p-0.75",
          nested && "rounded-xs",
        )}
        title={file.name}
      >
        <AttachmentMedia
          variant={image ? "image" : "icon"}
          className={cn(
            "w-5 group-data-[size=xs]/attachment:w-5",
            nested ? "rounded-[2px]" : "rounded-xs",
          )}
        >
          {state === "uploading" ? (
            <Spinner />
          ) : image ? (
            <img src={file.url} alt="" />
          ) : (
            <Icon />
          )}
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle className="font-normal">
            {middleCut(file.name)}
          </AttachmentTitle>
        </AttachmentContent>
        {onRemove && (
          <AttachmentAction
            aria-label={`Remove ${file.name}`}
            className="size-5 rounded-xs"
            onClick={onRemove}
          >
            <RiCloseLine />
          </AttachmentAction>
        )}
      </Attachment>
    );
  return (
    <Attachment size="sm" state={state}>
      <AttachmentMedia variant={image ? "image" : "icon"}>
        {state === "uploading" ? (
          <Spinner />
        ) : image ? (
          <img src={file.url} alt="" />
        ) : (
          <Icon />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{file.name}</AttachmentTitle>
        <AttachmentDescription>
          {state === "uploading"
            ? "Uploading"
            : `${fileKind(file)} · ${fileSize(file.size)}`}
        </AttachmentDescription>
      </AttachmentContent>
      {onRemove ? (
        <AttachmentActions>
          <AttachmentAction
            aria-label={`Remove ${file.name}`}
            onClick={onRemove}
          >
            <RiCloseLine />
          </AttachmentAction>
        </AttachmentActions>
      ) : (
        onOpen && (
          <AttachmentTrigger
            aria-label={`Open ${file.name}`}
            onClick={onOpen}
          />
        )
      )}
    </Attachment>
  );
}

// A long file name cut in the middle, keeping its end and type:
// "Banner-mob…08-10.jpg".
function middleCut(name: string) {
  return name.length > 24 ? `${name.slice(0, 10)}…${name.slice(-10)}` : name;
}
