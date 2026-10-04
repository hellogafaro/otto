import { RiAddLine, RiFileTextLine, RiSearchLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useCommandPalette } from "@/components/command-palette";
import { Dither } from "@/components/dither";
import { EmptyPage } from "@/components/empty-page";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { type Doc, documents } from "@/mock/tasks";

// All documents as a gallery, latest edits first.
export function DocumentsPage() {
  const openPalette = useCommandPalette();
  if (documents.length === 0) {
    return (
      <EmptyPage
        icon={RiFileTextLine}
        title="No documents"
        description="Notes and specs written by your team and agents live here."
      >
        <Button size="sm">
          <RiAddLine data-icon="inline-start" />
          New document
        </Button>
      </EmptyPage>
    );
  }

  const sorted = documents.toSorted((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <Page
      title="Documents"
      width="wide"
      actions={
        <>
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("documents")}
          />
          <IconAction label="New document" icon={RiAddLine} />
        </>
      }
    >
      <Gallery columns={4}>
        {sorted.map((document) => (
          <DocumentItem key={document.id} document={document} />
        ))}
      </Gallery>
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
    />
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
