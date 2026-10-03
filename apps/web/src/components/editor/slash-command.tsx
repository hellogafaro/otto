import {
  type RemixiconComponentType,
  RiCodeBoxLine,
  RiDoubleQuotesL,
  RiH1,
  RiH2,
  RiH3,
  RiImageLine,
  RiListCheck3,
  RiListOrdered,
  RiListUnordered,
  RiSeparator,
  RiTable2,
  RiText,
} from "@remixicon/react";
import { type Editor, Extension, type Range } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { Item, ItemMedia, ItemTitle } from "@workspace/ui/components/item";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ListProps,
  suggestionPopup,
  useSuggestionKeys,
} from "./suggestion-popup";
import { menuSurface } from "./surface";

type Command = {
  title: string;
  icon: RemixiconComponentType;
  run: (editor: Editor, range: Range) => void;
};

const commands: Command[] = [
  {
    title: "Text",
    icon: RiText,
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    title: "Heading 1",
    icon: RiH1,
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    icon: RiH2,
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run(),
  },
  {
    title: "Heading 3",
    icon: RiH3,
    run: (e, r) =>
      e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run(),
  },
  {
    title: "Bullet list",
    icon: RiListUnordered,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    icon: RiListOrdered,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: "Checklist",
    icon: RiListCheck3,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    title: "Table",
    icon: RiTable2,
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    // URL only for now; uploads need file storage (Artifacts).
    title: "Image",
    icon: RiImageLine,
    run: (e, r) => {
      const src = window.prompt("Image URL");
      if (!src) return;
      const alt = window.prompt("Alt text") ?? "";
      e.chain().focus().deleteRange(r).setImage({ src, alt }).run();
    },
  },
  {
    title: "Quote",
    icon: RiDoubleQuotesL,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: "Code block",
    icon: RiCodeBoxLine,
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    icon: RiSeparator,
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

function CommandList({ items, command, ref }: ListProps<Command>) {
  const [selected, setSelected] = useSuggestionKeys(ref, items, command);
  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      data-slot="suggestion-list"
      className={cn(menuSurface, "flex w-52 flex-col")}
    >
      {items.map((item, index) => (
        <Item
          key={item.title}
          size="xs"
          role="option"
          aria-selected={index === selected}
          className={index === selected ? "bg-foreground/10" : undefined}
          render={<button type="button" />}
          onMouseMove={() => setSelected(index)}
          onClick={() => command(item)}
        >
          <ItemMedia variant="icon">
            <item.icon />
          </ItemMedia>
          <ItemTitle className="font-normal">{item.title}</ItemTitle>
        </Item>
      ))}
    </div>
  );
}

// Type "/" to insert blocks.
export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<Command>({
        editor: this.editor,
        char: "/",
        items: ({ query }) =>
          commands.filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase()),
          ),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: suggestionPopup(CommandList),
      }),
    ];
  },
});
