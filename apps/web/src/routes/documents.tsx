import {
  RiAddLine,
  RiBox3Line,
  RiEyeLine,
  RiFileTextLine,
  RiPriceTag3Line,
  RiQuillPenLine,
  RiSearchLine,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ContextMenuContent } from "@workspace/ui/components/context-menu";
import { useCommandPalette } from "@/components/command-palette";
import { Dither } from "@/components/dither";
import { EmptyPage } from "@/components/empty-page";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  labelLooks,
  NoResults,
} from "@/components/filters";
import { useAskAgent } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { ItemMenuItems } from "@/components/item-menu";
import { Page } from "@/components/page";
import {
  chatWithLooks,
  ownerLooks,
  projectLooks,
  visibilityLooks,
} from "@/components/task-meta";
import {
  agents,
  currentUserId,
  type Doc,
  type DocumentVisibility,
  documents,
  projects,
  users,
} from "@/mock/tasks";

// Filters live in the URL, like Tasks': who created it ("me" or a person or
// agent), its project, a label, who can see it. A missing key means any.
export type DocumentsSearch = {
  createdBy?: string;
  project?: string;
  label?: string;
  visibility?: DocumentVisibility;
};

export function validateDocumentsSearch(
  search: Record<string, unknown>,
): DocumentsSearch {
  const pick = (value: unknown, valid: (value: string) => boolean) =>
    typeof value === "string" && valid(value) ? value : undefined;
  return {
    createdBy: pick(
      search.createdBy,
      (v) => v === "me" || v in users || v in agents,
    ),
    project: pick(search.project, (v) => v in projects),
    label: pick(search.label, () => true),
    visibility: pick(search.visibility, (v) => v in visibilityLooks) as
      | DocumentVisibility
      | undefined,
  };
}

const filters: FilterDef<keyof DocumentsSearch>[] = [
  {
    key: "createdBy",
    label: "Created by",
    icon: RiQuillPenLine,
    people: true,
    options: {
      me: { ...ownerLooks[currentUserId], label: "Me" },
      ...chatWithLooks,
    },
  },
  { key: "project", label: "Project", icon: RiBox3Line, options: projectLooks },
  {
    key: "label",
    label: "Label",
    icon: RiPriceTag3Line,
    options: labelLooks(documents.flatMap(({ labels = [] }) => labels)),
  },
  {
    key: "visibility",
    label: "Visibility",
    icon: RiEyeLine,
    options: visibilityLooks,
  },
];

function matches(document: Doc, search: DocumentsSearch) {
  const creator = search.createdBy === "me" ? currentUserId : search.createdBy;
  return (
    (!creator || document.createdBy === creator) &&
    (!search.project || document.projectId === search.project) &&
    (!search.label || (document.labels?.includes(search.label) ?? false)) &&
    (!search.visibility || document.visibility === search.visibility)
  );
}

// All documents as a gallery, latest edits first, filtered like Tasks.
export function DocumentsPage({ search }: { search: DocumentsSearch }) {
  const navigate = useNavigate({ from: "/documents" });
  const openPalette = useCommandPalette();
  const change = (key: keyof DocumentsSearch, value: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, [key]: value }) });
  const clear = () => navigate({ search: {} });
  if (documents.length === 0) {
    return (
      <EmptyPage
        icon={RiFileTextLine}
        title="No documents"
        description="Notes and specs written by your team and agents live here."
        ask={{
          about: "your documents",
          action: "New document",
          start: "Write a document about ",
        }}
      />
    );
  }

  const sorted = documents
    .filter((document) => matches(document, search))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Page
      title="Documents"
      width="wide"
      actions={
        <>
          <FilterMenu filters={filters} values={search} onChange={change} />
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("documents")}
          />
          <IconAction label="New document" icon={RiAddLine} />
        </>
      }
    >
      <FilterBar
        filters={filters}
        values={search}
        onChange={change}
        onClear={clear}
      />
      {sorted.length === 0 ? (
        <NoResults what="documents" onClear={clear} />
      ) : (
        <Gallery columns={4}>
          {sorted.map((document) => (
            <DocumentItem key={document.id} document={document} />
          ))}
        </Gallery>
      )}
    </Page>
  );
}

// A document's tile: its picture when it has one, else its opening text,
// fading out at the bottom. Portrait, like a page.
export function DocumentItem({ document }: { document: Doc }) {
  return (
    <GalleryItem
      render={
        <Link
          to="/documents/$documentId"
          params={{ documentId: document.id }}
        />
      }
      className="aspect-[4/5] bg-card"
      tile={
        document.image ? (
          <Dither src={document.image} className="size-full" />
        ) : (
          <p className="size-full mask-b-from-60% p-3 text-xs text-muted-foreground">
            {excerptOf(document.content)}
          </p>
        )
      }
      icon={RiFileTextLine}
      title={document.title}
      menu={<DocumentMenu document={document} />}
    />
  );
}

// A document's right-click menu: the shared item menu (Delete is not wired
// yet).
function DocumentMenu({ document }: { document: Doc }) {
  const navigate = useNavigate();
  const ask = useAskAgent();
  return (
    <ContextMenuContent className="w-48">
      <ItemMenuItems
        name={document.title}
        onOpen={() =>
          navigate({
            to: "/documents/$documentId",
            params: { documentId: document.id },
          })
        }
        onAsk={() => ask(`In the document "${document.title}", `)}
        link={`/documents/${document.id}`}
        onDelete={() => {}}
      />
    </ContextMenuContent>
  );
}

// The opening text of Markdown content: headings dropped, list and task
// markers and emphasis stripped.
function excerptOf(content: string) {
  return content
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ x]\]\s+)?/, ""))
    .join(" ")
    .replace(/[*_`]/g, "");
}
