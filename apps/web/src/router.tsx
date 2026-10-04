import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { NotFound } from "@/components/empty-page";
import { Page } from "@/components/page";
import { Shell } from "@/components/shell";
import { chats } from "@/mock/tasks";
import { ChatPage, NewChatPage } from "@/routes/chats";
import { DocumentPage } from "@/routes/document";
import { DocumentsPage, validateDocumentsSearch } from "@/routes/documents";
import { FilesPage, validateFilesSearch } from "@/routes/files";
import { InboxPage } from "@/routes/inbox";
import { ProjectPage, validateProjectSearch } from "@/routes/project";
import { ProjectsPage } from "@/routes/projects";
import {
  SchedulePage,
  SchedulesPage,
  validateSchedulesSearch,
} from "@/routes/schedules";
import { TaskPage } from "@/routes/task";
import { TasksPage, validateTasksSearch } from "@/routes/tasks";

const rootRoute = createRootRoute({ component: Shell });

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: InboxPage,
});

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
  validateSearch: validateDocumentsSearch,
  component: function Documents() {
    return <DocumentsPage search={documentsRoute.useSearch()} />;
  },
});

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$documentId",
  component: function Document() {
    return <DocumentPage documentId={documentRoute.useParams().documentId} />;
  },
});

const schedulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/schedules",
  validateSearch: validateSchedulesSearch,
  component: function Schedules() {
    return <SchedulesPage search={schedulesRoute.useSearch()} />;
  },
});

const scheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/schedules/$scheduleId",
  component: function ScheduleRoute() {
    const { scheduleId } = scheduleRoute.useParams();
    return <SchedulePage scheduleId={scheduleId} />;
  },
});

const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/files",
  validateSearch: validateFilesSearch,
  component: function Files() {
    return <FilesPage search={filesRoute.useSearch()} />;
  },
});

// Chats always has one open: /chats opens the first.
const chatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats",
  beforeLoad: () => {
    throw redirect({
      to: "/chats/$chatId",
      params: { chatId: chats[0].id },
    });
  },
});

// A new chat: who it is with and its project come in the URL (prefilled).
const newChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats/new",
  validateSearch: (search: Record<string, unknown>) => ({
    with: typeof search.with === "string" ? search.with : undefined,
    project: typeof search.project === "string" ? search.project : undefined,
  }),
  component: function NewChat() {
    return <NewChatPage search={newChatRoute.useSearch()} />;
  },
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats/$chatId",
  component: function Chat() {
    return <ChatPage chatId={chatRoute.useParams().chatId} />;
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
    inboxRoute,
    projectsRoute,
    projectRoute,
    chatsRoute,
    newChatRoute,
    chatRoute,
    documentsRoute,
    documentRoute,
    filesRoute,
    schedulesRoute,
    scheduleRoute,
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
