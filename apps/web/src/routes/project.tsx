import {
  type RemixiconComponentType,
  RiAlignLeft,
  RiBookShelfLine,
  RiBox3Line,
  RiCheckboxCircleLine,
  RiFileTextLine,
  RiHashtag,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AvatarGroup } from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useState } from "react";
import { AskOtto } from "@/components/ask-otto";
import {
  ChoiceItem,
  DetailView,
  PersonPicker,
  Section,
} from "@/components/detail";
import { Cover } from "@/components/dither";
import { Editor } from "@/components/editor/editor";
import { NotFound } from "@/components/empty-page";
import { Gallery } from "@/components/gallery";
import { ResourceGallery } from "@/components/resources";
import {
  ActorAvatar,
  actorOf,
  ownerLooks,
  priorities,
  projectStatuses,
} from "@/components/task-meta";
import {
  currentUserId,
  documents,
  type Project,
  type ProjectStatus,
  projects,
  resources,
  type TaskPriority,
  tasks,
} from "@/mock/tasks";
import { DocumentItem } from "@/routes/documents";
import { TaskGroups } from "@/routes/tasks";

// Section routes are built from the rail, so their paths are plain strings.
const conversations: string = "/conversations";

// The open tab lives in the URL; Overview (the description) is the default
// and has no key.
const tabs = ["overview", "tasks", "documents", "resources"] as const;
type ProjectTab = (typeof tabs)[number];
export type ProjectSearch = { tab?: Exclude<ProjectTab, "overview"> };

export function validateProjectSearch(
  search: Record<string, unknown>,
): ProjectSearch {
  const tab = tabs.find((value) => value === search.tab);
  return { tab: tab === "overview" ? undefined : tab };
}

export function ProjectPage({
  projectId,
  search,
}: {
  projectId: string;
  search: ProjectSearch;
}) {
  const project = projects[projectId];
  if (!project) {
    return (
      <NotFound
        icon={RiBox3Line}
        title="Project not found"
        description="It may have been deleted or moved."
      />
    );
  }
  return (
    <ProjectView
      key={projectId}
      id={projectId}
      project={project}
      tab={search.tab ?? "overview"}
    />
  );
}

// Same shape as a task: cover, title, owner and members on top; tabs for the
// description (Overview), tasks, documents and resources below; Status,
// Priority and Channel in the panel. No activity yet.
function ProjectView({
  id,
  project,
  tab,
}: {
  id: string;
  project: Project;
  tab: ProjectTab;
}) {
  const navigate = useNavigate({ from: "/projects/$projectId" });
  // Local only: nothing is saved yet.
  const [status, setStatus] = useState<ProjectStatus>(
    project.status ?? "planned",
  );
  const [priority, setPriority] = useState<TaskPriority>(
    project.priority ?? "none",
  );
  const [ownerId, setOwnerId] = useState(project.ownerId ?? currentUserId);
  const [description, setDescription] = useState(project.description ?? "");
  const members = project.memberIds ?? [];
  const names = members.map((member) => actorOf(member).name).join(", ");
  const projectTasks = tasks.filter((task) => task.projectId === id);
  const projectDocuments = documents.filter(
    (document) => document.projectId === id,
  );
  // A project's resources are those linked to its tasks.
  const projectResources = resources.filter((resource) =>
    projectTasks.some((task) => task.id === resource.taskId),
  );
  const counts: Record<ProjectTab, number> = {
    overview: 0,
    tasks: projectTasks.length,
    documents: projectDocuments.length,
    resources: projectResources.length,
  };

  return (
    <DetailView
      parent={{
        label: "Projects",
        icon: RiBox3Line,
        link: <Link to="/projects" />,
      }}
      current={projectStatuses[status]}
      title={project.title}
      ask={<AskOtto about="this project" />}
      cover={project.cover && <Cover src={project.cover} />}
      people={
        <>
          <PersonPicker
            label="Owner"
            value={ownerId}
            options={ownerLooks}
            onChange={setOwnerId}
            hotkey="o"
          />
          {members.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Members: ${names}`}
                  />
                }
              >
                <AvatarGroup>
                  {members.map((member) => (
                    <ActorAvatar key={member} actorId={member} />
                  ))}
                </AvatarGroup>
                {members.length} members
              </TooltipTrigger>
              <TooltipContent>{names}</TooltipContent>
            </Tooltip>
          )}
        </>
      }
      panel={
        <Section title="Properties">
          <ChoiceItem
            label="Status"
            value={status}
            options={projectStatuses}
            onChange={setStatus}
            hotkey="s"
          />
          <ChoiceItem
            label="Priority"
            value={priority}
            options={priorities}
            onChange={setPriority}
            hotkey="p"
            firstKey={0}
          />
          {/* The project's conversation; opening it lands in Conversations. */}
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to={conversations} />}
              aria-label={`Channel: ${project.channel ?? "none"}`}
            >
              <RiHashtag />
              <span>{project.channel ?? "No channel"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </Section>
      }
    >
      {/* Same 28px tabs as ⌘K, 4px apart, with icons; -ml-2.25 puts the first
          icon on the title's left edge (8px padding + 1px border). */}
      <div className="-ml-2.25 flex flex-wrap gap-1">
        {tabs.map((value) => {
          const { label, icon: Icon } = tabLooks[value];
          return (
            <Button
              key={value}
              variant={value === tab ? "secondary" : "ghost"}
              size="compact"
              aria-pressed={value === tab}
              onClick={() =>
                navigate({
                  search: value === "overview" ? {} : { tab: value },
                })
              }
            >
              <Icon data-icon="inline-start" />
              {label}
              {/* Counts only when there is something; Overview has none. */}
              {!!counts[value] && (
                <span className="text-muted-foreground tabular-nums">
                  {counts[value]}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {tab === "overview" && (
        <Editor
          key={id}
          value={description}
          onChange={setDescription}
          placeholder="Add description"
        />
      )}
      {tab === "tasks" &&
        (projectTasks.length > 0 ? (
          <TaskGroups tasks={projectTasks} showProject={false} />
        ) : (
          <TabEmpty
            icon={RiCheckboxCircleLine}
            title="No tasks"
            description="Tasks in this project show up here, grouped by status."
          />
        ))}
      {tab === "documents" &&
        (projectDocuments.length > 0 ? (
          <Gallery columns={4}>
            {projectDocuments.map((document) => (
              <DocumentItem key={document.id} document={document} />
            ))}
          </Gallery>
        ) : (
          <TabEmpty
            icon={RiFileTextLine}
            title="No documents"
            description="Notes and specs for this project collect here."
          />
        ))}
      {tab === "resources" &&
        (projectResources.length > 0 ? (
          <ResourceGallery resources={projectResources} />
        ) : (
          <TabEmpty
            icon={RiBookShelfLine}
            title="No resources"
            description="Files and results saved from this project's tasks collect here."
          />
        ))}
    </DetailView>
  );
}

// Tasks, Documents and Resources use their rail icons.
const tabLooks: Record<
  ProjectTab,
  { label: string; icon: RemixiconComponentType }
> = {
  overview: { label: "Overview", icon: RiAlignLeft },
  tasks: { label: "Tasks", icon: RiCheckboxCircleLine },
  documents: { label: "Documents", icon: RiFileTextLine },
  resources: { label: "Resources", icon: RiBookShelfLine },
};

// An empty tab: the empty state's shape, without an action.
function TabEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: RemixiconComponentType;
  title: string;
  description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
