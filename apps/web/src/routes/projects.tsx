import { RiAddLine, RiBox3Line, RiSearchLine } from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ContextMenuContent } from "@workspace/ui/components/context-menu";
import { useCommandPalette } from "@/components/command-palette";
import { Dither } from "@/components/dither";
import { EmptyPage } from "@/components/empty-page";
import { useAskAgent } from "@/components/floating-chat";
import { Gallery, GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { ItemMenuItems } from "@/components/item-menu";
import { mention } from "@/components/mentions";
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
        description="Projects gather tasks, chats and documents around one goal."
        ask={{
          about: "your projects",
          action: "New project",
          start: "Start a project to ",
        }}
      />
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
            menu={<ProjectMenu id={id} title={project.title} />}
          />
        ))}
      </Gallery>
    </Page>
  );
}

// A project's right-click menu: the shared item menu. Projects archive
// rather than delete (not wired yet).
function ProjectMenu({ id, title }: { id: string; title: string }) {
  const navigate = useNavigate();
  const ask = useAskAgent();
  return (
    <ContextMenuContent className="w-48">
      <ItemMenuItems
        name={title}
        onOpen={() =>
          navigate({ to: "/projects/$projectId", params: { projectId: id } })
        }
        onAsk={() => ask(`${mention({ type: "project", id, label: title })} `)}
        link={`/projects/${id}`}
        onArchive={() => {}}
      />
    </ContextMenuContent>
  );
}
