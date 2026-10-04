import {
  type RemixiconComponentType,
  RiBox3Line,
  RiCheckboxCircleLine,
  RiFileTextLine,
  RiRobot3Line,
  RiUserLine,
} from "@remixicon/react";
import Mention from "@tiptap/extension-mention";
import { PluginKey } from "@tiptap/pm/state";
import {
  type JSONContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment } from "react";
import {
  type ListProps,
  suggestionPopup,
  useSuggestionKeys,
} from "@/components/editor/suggestion-popup";
import { menuSurface } from "@/components/editor/surface";
import { ActorAvatar } from "@/components/task-meta";
import { agents, projects, taskResources, tasks, users } from "@/mock/tasks";

// "@" tags: people, agents, tasks, projects and resources. In text a tag is
// stored as @[label](type:id), so a comment stays a plain string.
export type MentionType = "user" | "agent" | "task" | "project" | "resource";

type Mentionable = {
  type: MentionType;
  id: string;
  label: string;
  hint?: string;
};

const groups: { type: MentionType; title: string }[] = [
  { type: "user", title: "People" },
  { type: "agent", title: "Agents" },
  { type: "task", title: "Tasks" },
  { type: "project", title: "Projects" },
  { type: "resource", title: "Resources" },
];

const mentionIcons: Record<MentionType, RemixiconComponentType> = {
  user: RiUserLine,
  agent: RiRobot3Line,
  task: RiCheckboxCircleLine,
  project: RiBox3Line,
  resource: RiFileTextLine,
};

const mentionables: Mentionable[] = [
  ...Object.entries(users).map(([id, user]) => ({
    type: "user" as const,
    id,
    label: user.name,
  })),
  // Not Otto: it is reached through Ask Otto, not tagged in comments.
  ...Object.entries(agents)
    .filter(([id]) => id !== "a_otto")
    .map(([id, agent]) => ({
      type: "agent" as const,
      id,
      label: agent.title,
    })),
  ...tasks.map((task) => ({
    type: "task" as const,
    id: task.id,
    label: task.title,
    hint: projects[task.projectId as keyof typeof projects]?.title,
  })),
  ...Object.entries(projects).map(([id, project]) => ({
    type: "project" as const,
    id,
    label: project.title,
  })),
  ...Object.values(taskResources)
    .flat()
    .map((resource) => ({
      type: "resource" as const,
      id: resource.id,
      label: resource.title,
    })),
];

// Up to three matches per group, in group order.
function search(query: string) {
  const needle = query.toLowerCase();
  return groups.flatMap(({ type }) =>
    mentionables
      .filter(
        (item) =>
          item.type === type && item.label.toLowerCase().includes(needle),
      )
      .slice(0, 3),
  );
}

export const mention = (item: Pick<Mentionable, "type" | "id" | "label">) =>
  `@[${item.label}](${item.type}:${item.id})`;

const token = /@\[([^\]]+)\]\((user|agent|task|project|resource):([^)]+)\)/g;

// A tag inside text: the icon of its type and the label, in the primary color.
export function MentionChip({
  type,
  label,
}: {
  type: MentionType;
  label: string;
}) {
  const Icon = mentionIcons[type];
  return (
    <span className="font-medium whitespace-nowrap text-primary">
      <Icon className="mr-1 inline -translate-y-px align-middle" />
      {label}
    </span>
  );
}

// Plain text with its tags rendered as chips (for sent comments).
export function MentionText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(token)) {
    parts.push(text.slice(last, match.index));
    parts.push(
      <MentionChip
        key={match.index}
        type={match[2] as MentionType}
        label={match[1]}
      />,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

// Editor document → stored text, and back.
export function toText(doc: JSONContent): string {
  return (doc.content ?? [])
    .map((block) =>
      (block.content ?? [])
        .map((node) => {
          if (node.type === "mention") {
            const [type, id] = String(node.attrs?.id).split(":");
            return mention({
              type: type as MentionType,
              id,
              label: node.attrs?.label,
            });
          }
          return node.type === "hardBreak" ? "\n" : (node.text ?? "");
        })
        .join(""),
    )
    .join("\n");
}

export function toContent(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split("\n").map((line) => {
      const content: JSONContent[] = [];
      let last = 0;
      for (const match of line.matchAll(token)) {
        if (match.index > last)
          content.push({ type: "text", text: line.slice(last, match.index) });
        content.push({
          type: "mention",
          attrs: { id: `${match[2]}:${match[3]}`, label: match[1] },
        });
        last = match.index + match[0].length;
      }
      if (last < line.length)
        content.push({ type: "text", text: line.slice(last) });
      return { type: "paragraph", content };
    }),
  };
}

function MentionNodeView({ node }: ReactNodeViewProps) {
  const [type] = String(node.attrs.id).split(":");
  return (
    <NodeViewWrapper as="span">
      <MentionChip type={type as MentionType} label={node.attrs.label} />
    </NodeViewWrapper>
  );
}

function MentionList({ items, command, ref }: ListProps<Mentionable>) {
  const pick = (item: Mentionable) =>
    command({ id: `${item.type}:${item.id}`, label: item.label });
  const [selected, setSelected] = useSuggestionKeys(ref, items, pick);
  if (items.length === 0) return null;

  return (
    // The card stays solid; the list inside scrolls past 320px so it always
    // fits above or below the caret. Rows keep their height (two-line rows
    // too). Like ⌘K: no scrollbar, edges fade while more is out of view.
    <div
      role="listbox"
      data-slot="suggestion-list"
      className={cn(menuSurface, "w-72")}
    >
      <div className="no-scrollbar flex max-h-78 scroll-fade-y flex-col overflow-y-auto *:shrink-0">
        {items.map((item, index) => {
          const Icon = mentionIcons[item.type];
          const first = index === 0 || items[index - 1].type !== item.type;
          return (
            <Fragment key={`${item.type}:${item.id}`}>
              {first && (
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {groups.find((group) => group.type === item.type)?.title}
                </div>
              )}
              <Item
                size="xs"
                role="option"
                aria-selected={index === selected}
                className={cn(
                  "flex-nowrap",
                  index === selected && "bg-foreground/10",
                )}
                render={<button type="button" />}
                // Moving, not entering: a list opening under a resting pointer
                // keeps the keyboard selection.
                onMouseMove={() => setSelected(index)}
                onClick={() => pick(item)}
              >
                {/* With a hint the row takes two lines; the media stays on the
                  title line (20px media, 20px title line). */}
                <ItemMedia
                  variant="icon"
                  className="group-has-data-[slot=item-description]/item:translate-y-0"
                >
                  {item.type === "user" || item.type === "agent" ? (
                    <ActorAvatar actorId={item.id} />
                  ) : (
                    // 20px slot, so labels line up with the avatar rows.
                    <span className="flex size-5 items-center justify-center">
                      <Icon />
                    </span>
                  )}
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-2 text-left leading-5 font-normal">
                    {item.label}
                  </ItemTitle>
                  {item.hint && <ItemDescription>{item.hint}</ItemDescription>}
                </ItemContent>
              </Item>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Lets the composer tell whether the palette is open (Enter picks, not sends).
export const mentionKey = new PluginKey("mention");

// Typing "@" opens the palette; a pick becomes a chip in the text.
export const Mentions = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
}).configure({
  renderText: ({ node }) => `@${node.attrs.label}`,
  suggestion: {
    char: "@",
    pluginKey: mentionKey,
    items: ({ query }) => search(query),
    render: suggestionPopup(MentionList),
  },
});
