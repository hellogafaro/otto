import { RiAddLine, RiBox3Line, RiSearchLine } from "@remixicon/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useCommandPalette } from "@/components/command-palette";
import { Dither } from "@/components/dither";
import { EmptyPage } from "@/components/empty-page";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { projects } from "@/mock/tasks";

// Projects as a gallery: each project is its dithered cover (or an empty
// muted tile) with its title under it. A card opens the project.
export function ProjectsPage() {
  const openPalette = useCommandPalette();
  const all = Object.entries(projects);

  if (all.length === 0) {
    return (
      <EmptyPage
        icon={RiBox3Line}
        title="No projects"
        description="Projects gather tasks, conversations and documents around one goal."
      >
        <Button size="sm">
          <RiAddLine data-icon="inline-start" />
          New project
        </Button>
      </EmptyPage>
    );
  }

  return (
    <Page
      title="Projects"
      width="wide"
      actions={
        <>
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("projects")}
          />
          <IconAction label="New project" icon={RiAddLine} />
        </>
      }
    >
      <Gallery columns={3}>
        {all.map(([id, project]) => (
          <GalleryItem
            key={id}
            render={
              <Link to="/projects/$projectId" params={{ projectId: id }} />
            }
            className="aspect-video bg-muted"
            tile={
              project.cover && (
                <Dither src={project.cover} className="size-full" />
              )
            }
            icon={RiBox3Line}
            title={project.title}
          />
        ))}
      </Gallery>
    </Page>
  );
}
