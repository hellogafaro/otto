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
import { toast } from "@workspace/ui/components/sonner";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment } from "react";
import {
  type ListProps,
  suggestionPopup,
  useSuggestionKeys,
} from "@/components/editor/suggestion-popup";
import { menuSurface } from "@/components/editor/surface";
import { ActorAvatar } from "@/components/task-meta";
import { read, workspaceApi } from "@/lib/api";
import {
  type MentionType,
  parseMentions,
  serializeMention,
} from "@/lib/mention-text";

// "@" tags: people, agents, tasks, projects and files. In text a tag is
// stored as @[label](type:id), so a comment stays a plain string.
export type { MentionType } from "@/lib/mention-text";

type Mentionable = {
  type: MentionType;
  id: string;
  label: string;
  hint?: string;
};

export type MentionParticipants = { userIds: string[]; agentIds: string[] };

const groups: { type: MentionType; title: string }[] = [
  { type: "user", title: "People" },
  { type: "agent", title: "Agents" },
  { type: "task", title: "Tasks" },
  { type: "project", title: "Projects" },
  { type: "file", title: "Files" },
];

const mentionIcons: Record<MentionType, RemixiconComponentType> = {
  user: RiUserLine,
  agent: RiRobot3Line,
  task: RiCheckboxCircleLine,
  project: RiBox3Line,
  file: RiFileTextLine,
};

// Suggestions use each domain's bounded whole-word query. Tasks require an explicit Project.
async function search(
  workspaceId: string,
  projectId: string | undefined,
  query: string,
  participants: MentionParticipants | undefined,
): Promise<Mentionable[]> {
  const param = { workspaceId };
  const filter = { query: query || undefined, limit: "3" };
  const results = await Promise.all([
    read(
      await workspaceApi.members.$get({
        param,
        query: {
          ...filter,
          sort: "name",
          userIds: participants
            ? JSON.stringify(participants.userIds)
            : undefined,
        },
      }),
    ).then((page) =>
      page.items.map((item) => ({
        type: "user" as const,
        id: item.userId,
        label: item.name,
      })),
    ),
    read(
      await workspaceApi.agents.$get({
        param,
        query: {
          ...filter,
          sort: "title",
          agentIds: participants
            ? JSON.stringify(participants.agentIds)
            : undefined,
        },
      }),
    ).then((page) =>
      page.items.map((item) => ({
        type: "agent" as const,
        id: item.id,
        label: item.title,
      })),
    ),
    projectId
      ? read(
          await workspaceApi.tasks.$get({
            param,
            query: { ...filter, projectId, sort: "title" },
          }),
        ).then((page) =>
          page.items.map((item) => ({
            type: "task" as const,
            id: item.id,
            label: item.title,
          })),
        )
      : Promise.resolve([]),
    read(
      await workspaceApi.projects.$get({
        param,
        query: { ...filter, sort: "title" },
      }),
    ).then((page) =>
      page.items.map((item) => ({
        type: "project" as const,
        id: item.id,
        label: item.title,
      })),
    ),
    read(
      await workspaceApi.files.$get({
        param,
        query: { ...filter, projectId, sort: "title" },
      }),
    ).then((page) =>
      page.items.map((item) => ({
        type: "file" as const,
        id: item.id,
        label: item.title,
      })),
    ),
  ]);
  return results.flat();
}

export const mention = serializeMention;

// A tag inside text: the icon of its type and the label, in the primary color
// on a soft primary tint with key-sized (xs 4) corners, so it reads as one
// thing in the composer, messages and comments alike.
export function MentionChip({
  type,
  label,
}: {
  type: MentionType;
  label: string;
}) {
  const Icon = mentionIcons[type];
  return (
    <span className="rounded-xs bg-primary/10 px-1 py-px font-medium whitespace-nowrap text-primary dark:bg-primary/15">
      <Icon className="mr-1 inline -translate-y-px align-middle" />
      {label}
    </span>
  );
}

// Plain text with its tags rendered as chips (for sent comments).
export function MentionText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of parseMentions(text)) {
    parts.push(text.slice(last, match.index));
    parts.push(
      <MentionChip key={match.index} type={match.type} label={match.label} />,
    );
    last = match.index + match.length;
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
            const identity = String(node.attrs?.id);
            const separator = identity.indexOf(":");
            const type = identity.slice(0, separator);
            const id = identity.slice(separator + 1);
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
      for (const match of parseMentions(line)) {
        if (match.index > last)
          content.push({ type: "text", text: line.slice(last, match.index) });
        content.push({
          type: "mention",
          attrs: { id: `${match.type}:${match.id}`, label: match.label },
        });
        last = match.index + match.length;
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
  if (items.length === 0)
    return (
      <div className={cn(menuSurface, "w-72 p-3")} role="status">
        No readable matches.
      </div>
    );

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
                  first title line. A long title wraps at 18px lines, tight
                  like the hint under it; one line still makes a 28px row. */}
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
                  <ItemTitle className="line-clamp-2 text-left leading-4.5 font-normal">
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
export const createMentions = (
  workspaceId: string,
  projectId?: () => string | undefined,
  participants?: () => MentionParticipants | undefined,
) =>
  Mention.extend({
    addNodeView() {
      return ReactNodeViewRenderer(MentionNodeView);
    },
  }).configure({
    renderText: ({ node }) => `@${node.attrs.label}`,
    suggestion: {
      char: "@",
      pluginKey: mentionKey,
      items: async ({ query }) => {
        try {
          return await search(
            workspaceId,
            projectId?.(),
            query,
            participants?.(),
          );
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Unable to load mentions.",
          );
          return [];
        }
      },
      render: suggestionPopup(MentionList),
    },
  });
