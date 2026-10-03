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
  "/projects": {
    title: "No projects",
    description:
      "Projects gather tasks, conversations and documents around one goal.",
    action: "New project",
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
  "/documents": {
    title: "No documents",
    description: "Notes and specs written by your team and agents live here.",
    action: "New document",
  },
  "/library": {
    title: "Library is empty",
    description: "Files and results saved from runs and tasks collect here.",
    action: "New resource",
  },
};

const sectionRoutes = destinations
  .filter(({ to }) => to !== "/tasks")
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
