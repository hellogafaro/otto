import {
  RiBold,
  RiCodeLine,
  RiDeleteColumn,
  RiDeleteRow,
  RiDoubleQuotesL,
  RiH2,
  RiH3,
  RiH4,
  RiInsertColumnRight,
  RiInsertRowBottom,
  RiItalic,
  RiListOrdered2,
  RiListUnordered,
  RiStrikethrough,
  RiTable2,
  RiText,
} from "@remixicon/react";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { PluginKey } from "@tiptap/pm/state";
import {
  EditorContent,
  Extension,
  useEditor,
  useEditorState,
  type Editor,
  type Range,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { StarterKit } from "@tiptap/starter-kit";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { PICKER_SURFACE_CLASS, PickerList, handlePickerKey, type PickerItem } from "./PickerList";
import { Button } from "./ui/button";
import { Popover, PopoverPopup } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/** Something inside Otto the editor can link to with @. */
export interface EditorLink {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly hint: string;
}

const NO_LINKS: ReadonlyArray<EditorLink> = [];

interface MenuEntry extends PickerItem {
  readonly run: (editor: Editor, range: Range) => void;
}

type MenuKind = "slash" | "mention";

interface OpenMenu {
  readonly kind: MenuKind;
  readonly query: string;
  readonly rect: (() => DOMRect | null) | null | undefined;
  readonly pick: (entry: MenuEntry) => void;
}

interface MenuHandlers {
  open: (kind: MenuKind, props: SuggestionProps<MenuEntry, MenuEntry>) => void;
  key: (event: KeyboardEvent) => boolean;
  close: () => void;
}

/** A `/` or `@` trigger whose menu React renders; the handlers ref always holds the latest render. */
function suggestionMenu(kind: MenuKind, char: string, handlers: { current: MenuHandlers }) {
  return Extension.create({
    name: `${kind}Menu`,
    addProseMirrorPlugins() {
      return [
        Suggestion<MenuEntry, MenuEntry>({
          editor: this.editor,
          char,
          pluginKey: new PluginKey(`${kind}-menu`),
          allowSpaces: kind === "mention",
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => handlers.current.open(kind, props),
            onUpdate: (props) => handlers.current.open(kind, props),
            onKeyDown: ({ event }) => handlers.current.key(event),
            onExit: () => handlers.current.close(),
          }),
        }),
      ];
    },
  });
}

type ToolbarAction = {
  readonly label: string;
  readonly icon: typeof RiH2;
  readonly active?: boolean;
  readonly run: () => void;
};

/**
 * Otto: Rich text for task and project descriptions, stored as Markdown.
 * Paragraphs, H2–H4, lists, quotes, inline marks, links and tables; no
 * images. Typing / opens a block menu, @ links a task, project, bot or group,
 * and selecting text shows a floating formatting toolbar. Markdown shortcuts
 * still work as you type.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
  className,
  links = NO_LINKS,
  editable = true,
}: {
  /** Markdown; read once when the editor mounts, so key the editor to reset it. */
  readonly value: string;
  readonly onChange?: (markdown: string) => void;
  /** Called with the current Markdown when focus leaves the editor. */
  readonly onBlur?: (markdown: string) => void;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly className?: string;
  /** What @ can link to; each link is stored as a Markdown link to its Otto page. */
  readonly links?: ReadonlyArray<EditorLink>;
  /** False shows the Markdown read-only; read once on mount like the value. */
  readonly editable?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const callbacks = useRef({ onChange, onBlur, navigate });
  callbacks.current = { onChange, onBlur, navigate };
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [active, setActive] = useState(0);

  const handlers = useRef<MenuHandlers>({
    open: () => undefined,
    key: () => false,
    close: () => undefined,
  });

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
      suggestionMenu("slash", "/", handlers),
      suggestionMenu("mention", "@", handlers),
    ],
    content: value,
    contentType: "markdown",
    immediatelyRender: true,
    editable,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "rich-text chat-markdown min-h-6 text-sm leading-relaxed outline-none",
      },
      // Links to Otto pages open in place; web links keep their own behavior.
      handleClick: (_view, _pos, event) => {
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        const href = anchor?.getAttribute("href");

        if (!href?.startsWith("/")) return false;
        event.preventDefault();
        void callbacks.current.navigate({ href });

        return true;
      },
    },
    onUpdate: ({ editor: current }) => callbacks.current.onChange?.(current.getMarkdown()),
    onBlur: ({ editor: current }) => callbacks.current.onBlur?.(current.getMarkdown()),
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: current }: { editor: Editor }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bullets: current.isActive("bulletList"),
      numbers: current.isActive("orderedList"),
      inTable: current.isActive("table"),
    }),
  });

  const block =
    (apply: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) =>
    (current: Editor, range: Range) =>
      void apply(current.chain().focus().deleteRange(range)).run();

  const blocks: MenuEntry[] = [
    { key: "text", label: t("Text"), icon: <RiText />, run: block((c) => c.setParagraph()) },
    {
      key: "h2",
      label: t("Heading 2"),
      icon: <RiH2 />,
      run: block((c) => c.setHeading({ level: 2 })),
    },
    {
      key: "h3",
      label: t("Heading 3"),
      icon: <RiH3 />,
      run: block((c) => c.setHeading({ level: 3 })),
    },
    {
      key: "h4",
      label: t("Heading 4"),
      icon: <RiH4 />,
      run: block((c) => c.setHeading({ level: 4 })),
    },
    {
      key: "bullets",
      label: t("Bulleted list"),
      icon: <RiListUnordered />,
      run: block((c) => c.toggleBulletList()),
    },
    {
      key: "numbers",
      label: t("Numbered list"),
      icon: <RiListOrdered2 />,
      run: block((c) => c.toggleOrderedList()),
    },
    {
      key: "quote",
      label: t("Quote"),
      icon: <RiDoubleQuotesL />,
      run: block((c) => c.toggleBlockquote()),
    },
    {
      key: "table",
      label: t("Table"),
      icon: <RiTable2 />,
      run: block((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })),
    },
  ];

  const query = menu?.query.trim().toLowerCase() ?? "";

  const items: ReadonlyArray<MenuEntry> =
    menu === null
      ? []
      : menu.kind === "slash"
        ? blocks.filter((entry) => entry.label.toLowerCase().includes(query))
        : links
            .filter((link) => link.label.toLowerCase().includes(query))
            .toSorted(
              (a, b) =>
                Number(!a.label.toLowerCase().startsWith(query)) -
                Number(!b.label.toLowerCase().startsWith(query)),
            )
            .slice(0, 8)
            .map((link) => ({
              key: link.key,
              label: link.label,
              icon: link.icon,
              hint: link.hint,
              run: (current: Editor, range: Range) =>
                void current
                  .chain()
                  .focus()
                  .deleteRange(range)
                  .insertContent([
                    {
                      type: "text",
                      text: `@${link.label}`,
                      marks: [{ type: "link", attrs: { href: link.href, target: null } }],
                    },
                    { type: "text", text: " " },
                  ])
                  .run(),
            }));

  handlers.current = {
    open: (kind, props) => {
      setMenu({
        kind,
        query: props.query,
        rect: props.clientRect,
        pick: (entry) => props.command(entry),
      });
      setActive(0);
    },
    key: (event) => {
      if (menu === null) return false;

      if (event.key === "Escape") {
        setMenu(null);

        return true;
      }

      return handlePickerKey(event.key, items, active, setActive, menu.pick);
    },
    close: () => setMenu(null),
  };

  const chain = () => editor.chain().focus();

  const actions: ToolbarAction[] = state.inTable
    ? [
        { label: t("Add row"), icon: RiInsertRowBottom, run: () => chain().addRowAfter().run() },
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
          label: t("Bold"),
          icon: RiBold,
          active: state.bold,
          run: () => chain().toggleBold().run(),
        },
        {
          label: t("Italic"),
          icon: RiItalic,
          active: state.italic,
          run: () => chain().toggleItalic().run(),
        },
        {
          label: t("Strikethrough"),
          icon: RiStrikethrough,
          active: state.strike,
          run: () => chain().toggleStrike().run(),
        },
        {
          label: t("Inline code"),
          icon: RiCodeLine,
          active: state.code,
          run: () => chain().toggleCode().run(),
        },
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
      ];

  return (
    <div className={cn("flex flex-col", className)}>
      <EditorContent editor={editor} />
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: current, state: editorState }) =>
          current.isFocused && (!editorState.selection.empty || current.isActive("table"))
        }
        role="toolbar"
        aria-label={t("Formatting")}
        className={cn(PICKER_SURFACE_CLASS, "flex items-center gap-0.5 p-1")}
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
      </BubbleMenu>
      <Popover open={menu !== null} onOpenChange={(open) => !open && setMenu(null)}>
        <PopoverPopup
          side="bottom"
          align="start"
          initialFocus={false}
          finalFocus={false}
          viewportPadding="none"
          className="w-64"
          anchor={{
            getBoundingClientRect: () => menu?.rect?.() ?? new DOMRect(),
          }}
        >
          {menu ? (
            <div className="max-h-72 overflow-y-auto p-1">
              <PickerList
                items={items}
                active={active}
                emptyLabel={t("No results")}
                onActiveChange={setActive}
                onPick={menu.pick}
              />
            </div>
          ) : null}
        </PopoverPopup>
      </Popover>
    </div>
  );
}
