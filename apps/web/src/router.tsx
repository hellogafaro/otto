import { RiAddLine } from "@remixicon/react";
import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { destinations } from "@/components/app-rail";
import { EmptyPage, NotFound } from "@/components/empty-page";
import { Page } from "@/components/page";
import { Shell } from "@/components/shell";
import { DocumentPage } from "@/routes/document";
import { DocumentsPage } from "@/routes/documents";
import { ProjectPage, validateProjectSearch } from "@/routes/project";
import { ProjectsPage } from "@/routes/projects";
import { ResourcesPage, validateResourcesSearch } from "@/routes/resources";
import { TaskPage } from "@/routes/task";
import { TasksPage, validateTasksSearch } from "@/routes/tasks";

const rootRoute = createRootRoute({ component: Shell });

// Sections without data yet show their empty state: the rail icon, what
// belongs there, and the one way to start.
const empties: Record<
  string,
  { title: string; description: string; action: string }
> = {
  "/": {
    title: "Nothing needs you",
    description: "Tasks, mentions and reviews waiting on you show up here.",
    action: "New task",
  },
  "/conversations": {
    title: "No conversations",
    description: "Talk things through with people and agents here.",
    action: "New conversation",
  },
  "/schedules": {
    title: "No schedules",
    description:
      "Schedules run an agent on a trigger and post where you choose.",
    action: "New schedule",
  },
};

const sectionRoutes = destinations
  .filter(
    ({ to }) =>
      !["/tasks", "/projects", "/documents", "/resources"].includes(to),
  )
  .map(({ to, icon }) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: to,
      component: () => (
        <EmptyPage
          icon={icon}
          title={empties[to].title}
          description={empties[to].description}
        >
          <Button size="sm">
            <RiAddLine data-icon="inline-start" />
            {empties[to].action}
          </Button>
        </EmptyPage>
      ),
    }),
  );

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsPage,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  validateSearch: validateProjectSearch,
  component: function Project() {
    return (
      <ProjectPage
        projectId={projectRoute.useParams().projectId}
        search={projectRoute.useSearch()}
      />
    );
  },
});

const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: DocumentsPage,
});

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  component: function Document() {
    return <DocumentPage documentId={documentRoute.useParams().documentId} />;
  },
});

const resourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/resources",
  validateSearch: validateResourcesSearch,
  component: function Resources() {
    return <ResourcesPage search={resourcesRoute.useSearch()} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks",
  validateSearch: validateTasksSearch,
  component: function Tasks() {
    return <TasksPage search={tasksRoute.useSearch()} />;
  },
});

const taskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  component: function Task() {
    return <TaskPage taskId={taskRoute.useParams().taskId} />;
  },
});

// Opened from the profile menu, not the rail.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => <Page title="Settings" />,
});

export const router = createRouter({
  defaultNotFoundComponent: () => <NotFound />,
  routeTree: rootRoute.addChildren([
    ...sectionRoutes,
    projectsRoute,
    projectRoute,
    documentsRoute,
    documentRoute,
    resourcesRoute,
    tasksRoute,
    taskRoute,
    settingsRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
