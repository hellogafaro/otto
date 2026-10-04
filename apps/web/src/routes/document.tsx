import { RiBox3Line, RiFileTextLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChoiceItem, DetailView, Section } from "@/components/detail";
import { Cover } from "@/components/dither";
import { Editor } from "@/components/editor/editor";
import { NotFound } from "@/components/empty-page";
import { FloatingChat } from "@/components/floating-chat";
import {
  ActorAvatar,
  actorOf,
  type Look,
  projectLooks,
  visibilityLooks,
} from "@/components/task-meta";
import { type Doc, type DocumentVisibility, documents } from "@/mock/tasks";

// A document may belong to no project.
const documentProjectLooks: Record<string, Look> = {
  none: {
    label: "No project",
    icon: RiBox3Line,
    className: "text-muted-foreground",
  },
  ...projectLooks,
};

export function DocumentPage({ documentId }: { documentId: string }) {
  const document = documents.find(({ id }) => id === documentId);
  if (!document) {
    return (
      <NotFound
        icon={RiFileTextLine}
        title="Document not found"
        description="It may have been deleted or moved."
      />
    );
  }
  return <DocumentView key={documentId} document={document} />;
}

// Same shape as a task and a project: cover, title and author on top, the
// content as the body, Project and Visibility in the panel. No activity yet.
function DocumentView({ document }: { document: Doc }) {
  // Local only: nothing is saved yet.
  const [content, setContent] = useState(document.content);
  const [projectId, setProjectId] = useState(document.projectId ?? "none");
  const [visibility, setVisibility] = useState<DocumentVisibility>(
    document.visibility,
  );

  return (
    <DetailView
      parent={{
        label: "Documents",
        icon: RiFileTextLine,
        link: <Link to="/documents" />,
      }}
      current={{ icon: RiFileTextLine }}
      title={document.title}
      type="document"
      ask={
        <FloatingChat
          about="this document"
          projectId={projectId === "none" ? undefined : projectId}
        />
      }
      cover={document.image && <Cover src={document.image} />}
      people={
        // The author is set by the server and cannot change, so it is plain
        // text in the shape of the pickers (8px padding + 1px border).
        <span className="flex h-8 items-center gap-2 border border-transparent px-2 font-medium">
          <ActorAvatar actorId={document.createdBy} />
          {actorOf(document.createdBy).name}
        </span>
      }
      panel={
        <Section title="Properties">
          <ChoiceItem
            label="Project"
            value={projectId}
            options={documentProjectLooks}
            onChange={setProjectId}
            searchable
          />
          <ChoiceItem
            label="Visibility"
            value={visibility}
            options={visibilityLooks}
            onChange={setVisibility}
            hotkey="v"
          />
        </Section>
      }
    >
      <Editor
        value={content}
        onChange={setContent}
        placeholder="Start writing"
      />
    </DetailView>
  );
}
