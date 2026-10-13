import {
  RiDeleteColumn,
  RiDeleteRow,
  RiH2,
  RiH3,
  RiH4,
  RiInsertColumnRight,
  RiInsertRowBottom,
  RiListOrdered2,
  RiListUnordered,
  RiTable2,
} from "@remixicon/react";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useRef } from "react";

import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

type ToolbarAction = {
  readonly label: string;
  readonly icon: typeof RiH2;
  readonly active?: boolean;
  readonly run: () => void;
};

/**
 * Otto: Rich text for task and project descriptions, stored as Markdown.
 * Paragraphs, H2–H4, bullet and numbered lists, quotes, inline marks, links
 * and tables; no images. Markdown shortcuts work as you type, and a quiet row
 * of 24px tools appears under it only while the editor has focus.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
  className,
}: {
  /** Markdown; read once when the editor mounts, so key the editor to reset it. */
  readonly value: string;
  readonly onChange?: (markdown: string) => void;
  /** Called with the current Markdown when focus leaves the editor. */
  readonly onBlur?: (markdown: string) => void;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const callbacks = useRef({ onChange, onBlur });
  callbacks.current = { onChange, onBlur };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
      }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: true,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "rich-text chat-markdown min-h-6 text-sm leading-relaxed outline-none",
      },
    },
    onUpdate: ({ editor: current }) => callbacks.current.onChange?.(current.getMarkdown()),
    onBlur: ({ editor: current }) => callbacks.current.onBlur?.(current.getMarkdown()),
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: current }: { editor: Editor }) => ({
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      h4: current.isActive("heading", { level: 4 }),
      bullets: current.isActive("bulletList"),
      numbers: current.isActive("orderedList"),
      inTable: current.isActive("table"),
    }),
  });

  const chain = () => editor.chain().focus();

  const actions: ToolbarAction[] = [
    {
      label: t("Heading 2"),
      icon: RiH2,
      active: state.h2,
      run: () => chain().toggleHeading({ level: 2 }).run(),
    },
    {
      label: t("Heading 3"),
      icon: RiH3,
      active: state.h3,
      run: () => chain().toggleHeading({ level: 3 }).run(),
    },
    {
      label: t("Heading 4"),
      icon: RiH4,
      active: state.h4,
      run: () => chain().toggleHeading({ level: 4 }).run(),
    },
    {
      label: t("Bulleted list"),
      icon: RiListUnordered,
      active: state.bullets,
      run: () => chain().toggleBulletList().run(),
    },
    {
      label: t("Numbered list"),
      icon: RiListOrdered2,
      active: state.numbers,
      run: () => chain().toggleOrderedList().run(),
    },
    ...(state.inTable
      ? [
          {
            label: t("Add row"),
            icon: RiInsertRowBottom,
            run: () => chain().addRowAfter().run(),
          },
          {
            label: t("Add column"),
            icon: RiInsertColumnRight,
            run: () => chain().addColumnAfter().run(),
          },
          { label: t("Delete row"), icon: RiDeleteRow, run: () => chain().deleteRow().run() },
          {
            label: t("Delete column"),
            icon: RiDeleteColumn,
            run: () => chain().deleteColumn().run(),
          },
        ]
      : [
          {
            label: t("Insert table"),
            icon: RiTable2,
            run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          },
        ]),
  ];

  return (
    <div className={cn("group/editor flex flex-col gap-1", className)}>
      <EditorContent editor={editor} />
      <div
        role="toolbar"
        aria-label={t("Formatting")}
        className="hidden h-6 items-center gap-0.5 group-focus-within/editor:flex"
      >
        {actions.map((action) => (
          <Tooltip key={action.label}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-row"
                  variant="ghost-muted"
                  aria-label={action.label}
                  aria-pressed={action.active}
                  // Keep the selection in the editor while a tool runs.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={action.run}
                >
                  <action.icon className="size-3.5" />
                </Button>
              }
            />
            <TooltipPopup>{action.label}</TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
