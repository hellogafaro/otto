import {
  type RemixiconComponentType,
  RiAddLine,
  RiArrowUpLine,
  RiCloseLine,
  RiFileLine,
  RiFileTextLine,
  RiMicLine,
  RiStopFill,
  RiVideoLine,
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
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Mentions, mentionKey, toContent, toText } from "@/components/mentions";
import "@/components/editor/editor.css";

export type FileRef = {
  id: string;
  name: string;
  type: string;
  size: number;
  // Object URL for local files; a stored file URL once uploads exist.
  url: string;
};

type Pending = FileRef & { state: "uploading" | "done" };

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
// Uploads are simulated until storage exists. `compact` is the one-line
// floating bar (Ask Otto): + on the left, the main button on the right.
export function Composer({
  onSend,
  placeholder,
  tools,
  busy = false,
  onStop,
  compact = false,
  ref,
}: {
  onSend: (text: string, files: FileRef[]) => void;
  placeholder: string;
  tools?: ReactNode;
  busy?: boolean;
  onStop?: () => void;
  compact?: boolean;
  ref?: Ref<ComposerHandle>;
}) {
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Latest handlers for the editor's key and paste hooks.
  const actions = useRef({ send: () => {}, add: (_: FileList) => {} });

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
      Placeholder.configure({ placeholder }),
      Mentions,
      SendOnEnter.configure({ onEnter: () => actions.current.send() }),
    ],
    editorProps: {
      // One line tall until it grows with the text, up to 240px. The
      // compact bar stays one line and scrolls sideways as you type.
      attributes: {
        class: compact
          ? "otto-composer no-scrollbar overflow-x-auto overflow-y-hidden p-1 text-sm whitespace-pre! outline-none"
          : "otto-composer max-h-60 overflow-y-auto px-4 pt-3 text-sm outline-none",
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
  const empty = useEditorState({
    editor,
    selector: ({ editor }) => editor?.isEmpty ?? true,
  });
  const dictation = useDictation(editor);
  const uploading = files.some((file) => file.state === "uploading");
  const hasContent = !empty || files.length > 0;
  const canSend = hasContent && !uploading && !busy;

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
    const added = [...list].map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
      state: "uploading" as const,
    }));
    setFiles((current) => [...current, ...added]);
    for (const { id } of added) {
      setTimeout(
        () =>
          setFiles((current) =>
            current.map((file) =>
              file.id === id ? { ...file, state: "done" } : file,
            ),
          ),
        900,
      );
    }
  };

  const remove = (id: string) =>
    setFiles((current) => {
      const file = current.find((candidate) => candidate.id === id);
      if (file) URL.revokeObjectURL(file.url);
      return current.filter((candidate) => candidate.id !== id);
    });

  const send = () => {
    if (!canSend || !editor) return;
    dictation.stop();
    onSend(
      toText(editor.getJSON()).trim(),
      files.map(({ state: _state, ...file }) => file),
    );
    editor.commands.clearContent(true);
    setFiles([]);
  };
  actions.current = { send, add };

  // One main action, in priority order.
  const main = busy ? (
    <MainButton label="Stop" onClick={onStop}>
      <RiStopFill />
    </MainButton>
  ) : dictation.listening ? (
    <MainButton label="Stop dictation" onClick={dictation.stop}>
      <RiStopFill />
    </MainButton>
  ) : hasContent ? (
    <MainButton label="Send" type="submit" disabled={!canSend}>
      <RiArrowUpLine />
    </MainButton>
  ) : (
    <MainButton
      label={dictation.supported ? "Dictate" : "Dictation isn't available"}
      disabled={!dictation.supported}
      onClick={dictation.start}
    >
      <RiMicLine />
    </MainButton>
  );

  const attachments = files.length > 0 && (
    // Attachment borders sit 9px in (top and sides), like the buttons'
    // visible edges below; their file icons land on the 16px text line.
    // AttachmentGroup adds 4px above, so pt-1.25 + 4 = 9. In the compact bar
    // nothing pads below them: the row's own 8px is the gap.
    <InputGroupAddon
      align="block-start"
      className={cn("px-2.25 pt-1.25", compact && "pb-0")}
    >
      <AttachmentGroup className={cn("w-full", compact && "pb-0")}>
        {files.map((file) => (
          <FileAttachment
            key={file.id}
            file={file}
            state={file.state}
            onRemove={() => remove(file.id)}
          />
        ))}
      </AttachmentGroup>
    </InputGroupAddon>
  );

  const plus = (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            size="icon-sm"
            aria-label="Add files"
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
        send();
      }}
    >
      {/* Same surface as a comment card (xl radius, card background, faint
          ring). Two insets: visible edges (attachment borders, button
          backgrounds) sit 9px in; content (text, icons) sits 16px in. The
          compact bar keeps the corners and floats (shadow-md). */}
      <InputGroup
        data-dragging={dragging}
        className={cn(
          "border-0 bg-card ring-1 ring-foreground/10 data-[dragging=true]:ring-ring dark:bg-card",
          "rounded-xl",
          compact ? "h-auto shadow-md" : "shadow-xs",
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
          // One row, 48px: buttons 9px from the visible edges, text 48px in
          // (8px padding + 32px button + 4px gap + 4px text padding).
          <div className="flex w-full items-center gap-1 p-2">
            {plus}
            <EditorContent editor={editor} className="min-w-0 flex-1" />
            {tools}
            {main}
          </div>
        ) : (
          <>
            <EditorContent editor={editor} className="w-full" />
            <InputGroupAddon align="block-end" className="p-2">
              {plus}
              {tools}
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

// Browser speech-to-text (Web Speech API), typed in at the cursor.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const SpeechRecognition =
  (
    window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    }
  ).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
    .webkitSpeechRecognition;

function useDictation(editor: Editor | null) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  const start = () => {
    if (!SpeechRecognition || !editor) return;
    // Results replace what this session typed so far, at the cursor.
    const at = editor.state.selection.to;
    const before = editor.state.doc.textBetween(Math.max(0, at - 1), at);
    const lead = before && before !== " " ? " " : "";
    let typed = 0;
    const session = new SpeechRecognition();
    session.continuous = true;
    session.interimResults = true;
    session.onresult = (event) => {
      const heard =
        lead +
        Array.from(event.results, (result) => result[0].transcript).join("");
      editor
        .chain()
        .deleteRange({ from: at, to: at + typed })
        .insertContentAt(at, heard)
        .run();
      typed = heard.length;
    };
    session.onend = () => setListening(false);
    recognition.current = session;
    session.start();
    setListening(true);
  };

  const stop = () => {
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
  };

  return { supported: Boolean(SpeechRecognition), listening, start, stop };
}

const fileIcons: [string, RemixiconComponentType][] = [
  ["video/", RiVideoLine],
  ["text/", RiFileTextLine],
  ["application/pdf", RiFileTextLine],
];

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

// One file, pending in the composer (removable) or sent (opens the file).
export function FileAttachment({
  file,
  state = "done",
  onRemove,
}: {
  file: FileRef;
  state?: "uploading" | "done";
  onRemove?: () => void;
}) {
  const Icon =
    fileIcons.find(([prefix]) => file.type.startsWith(prefix))?.[1] ??
    RiFileLine;
  const image = file.type.startsWith("image/");
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
        <AttachmentTrigger
          render={
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${file.name}`}
            />
          }
        />
      )}
    </Attachment>
  );
}
