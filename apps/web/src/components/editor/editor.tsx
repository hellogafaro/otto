import {
  type RemixiconComponentType,
  RiBold,
  RiCodeLine,
  RiDeleteBinLine,
  RiDeleteColumn,
  RiDeleteRow,
  RiInsertColumnRight,
  RiInsertRowBottom,
  RiItalic,
  RiLink,
  RiStrikethrough,
} from "@remixicon/react";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import {
  EditorContent,
  type Editor as TiptapEditor,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";
import { Separator } from "@workspace/ui/components/separator";
import { Toggle } from "@workspace/ui/components/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment } from "react";
import { SlashCommand } from "./slash-command";
import { menuSurface } from "./surface";
import "./editor.css";

// Markdown-in, markdown-out rich text editor (Tiptap). Supports GitHub-flavored
// markdown: headings, lists, checklists, quotes, code, links, images, tables
// and dividers. "/" inserts blocks, selecting text shows formatting, and the
// cursor in a table shows table controls.
export function Editor({
  value,
  onChange,
  placeholder,
  readOnly = false,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  /** Rendered only (e.g. a Markdown file in the file viewer). */
  readOnly?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder }),
      Image,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      SlashCommand,
    ],
    content: value,
    contentType: "markdown",
    editable: !readOnly,
    editorProps: { attributes: { class: "otto-editor" } },
    onUpdate: ({ editor }) => onChange?.(editor.getMarkdown()),
  });

  return (
    <>
      <EditorContent editor={editor} />
      {editor && !readOnly && <FormatMenu editor={editor} />}
      {editor && !readOnly && <TableMenu editor={editor} />}
    </>
  );
}

const marks: {
  name: string;
  label: string;
  icon: RemixiconComponentType;
  keys?: string;
  toggle: (editor: TiptapEditor) => void;
}[] = [
  {
    name: "bold",
    label: "Bold",
    icon: RiBold,
    keys: "⌘B",
    toggle: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    name: "italic",
    label: "Italic",
    icon: RiItalic,
    keys: "⌘I",
    toggle: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    name: "strike",
    label: "Strikethrough",
    icon: RiStrikethrough,
    keys: "⌘⇧S",
    toggle: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    name: "code",
    label: "Code",
    icon: RiCodeLine,
    keys: "⌘E",
    toggle: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    name: "link",
    label: "Link",
    icon: RiLink,
    toggle: (e) => {
      if (e.isActive("link")) {
        e.chain().focus().unsetLink().run();
        return;
      }
      const href = window.prompt("Link URL");
      if (href) e.chain().focus().setLink({ href }).run();
    },
  },
];

function FormatMenu({ editor }: { editor: TiptapEditor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      Object.fromEntries(
        marks.map(({ name }) => [name, editor.isActive(name)]),
      ),
  });

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatMenu"
      className={cn(menuSurface, "flex items-center gap-1")}
    >
      {marks.map(({ name, label, icon: Icon, keys, toggle }) => (
        <Fragment key={name}>
          {/* Link sits apart from the inline marks. */}
          {name === "link" && (
            <Separator orientation="vertical" className="h-4" />
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="icon-sm"
                  aria-label={label}
                  pressed={active[name]}
                  onPressedChange={() => toggle(editor)}
                />
              }
            >
              <Icon />
            </TooltipTrigger>
            <TooltipContent>
              {label}
              {keys && <Kbd>{keys}</Kbd>}
            </TooltipContent>
          </Tooltip>
        </Fragment>
      ))}
    </BubbleMenu>
  );
}

const tableActions: {
  label: string;
  icon: RemixiconComponentType;
  run: (editor: TiptapEditor) => void;
}[] = [
  {
    label: "Add row below",
    icon: RiInsertRowBottom,
    run: (e) => e.chain().focus().addRowAfter().run(),
  },
  {
    label: "Add column right",
    icon: RiInsertColumnRight,
    run: (e) => e.chain().focus().addColumnAfter().run(),
  },
  {
    label: "Delete row",
    icon: RiDeleteRow,
    run: (e) => e.chain().focus().deleteRow().run(),
  },
  {
    label: "Delete column",
    icon: RiDeleteColumn,
    run: (e) => e.chain().focus().deleteColumn().run(),
  },
  {
    label: "Delete table",
    icon: RiDeleteBinLine,
    run: (e) => e.chain().focus().deleteTable().run(),
  },
];

// Shown while the cursor is inside a table (and no text is selected).
function TableMenu({ editor }: { editor: TiptapEditor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      shouldShow={({ editor, state }) =>
        editor.isActive("table") && state.selection.empty
      }
      className={cn(menuSurface, "flex items-center gap-1")}
    >
      {tableActions.map(({ label, icon: Icon, run }) => (
        <Button
          key={label}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          onClick={() => run(editor)}
        >
          <Icon />
        </Button>
      ))}
    </BubbleMenu>
  );
}
