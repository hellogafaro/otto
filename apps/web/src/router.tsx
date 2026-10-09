import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { NotFound } from "@/components/empty-page";
import { PublicSharePage } from "@/components/public-share";
import { Shell } from "@/components/shell";
import { AgentSettingsPage } from "@/routes/agent-settings";
import {
  ChatPage,
  ChatsLandingPage,
  NewChatPage,
  validateChatsSearch,
} from "@/routes/chats";
import { DocumentPage } from "@/routes/document";
import { DocumentsPage, validateDocumentsSearch } from "@/routes/documents";
import { FilesPage, validateFilesSearch } from "@/routes/files";
import { InboxPage } from "@/routes/inbox";
import { ProjectPage, validateProjectSearch } from "@/routes/project";
import { ProjectsPage, validateProjectsSearch } from "@/routes/projects";
import {
  SchedulePage,
  SchedulesPage,
  validateSchedulesSearch,
} from "@/routes/schedules";
import { isSettingsSection, SettingsPage } from "@/routes/settings";
import { TaskPage } from "@/routes/task";
import { TasksPage, validateTasksSearch } from "@/routes/tasks";

const rootRoute = createRootRoute({ component: Outlet });
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: Shell,
});
const publicShareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/shares/$shareId",
  component: function PublicShare() {
    return <PublicSharePage shareId={publicShareRoute.useParams().shareId} />;
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: InboxPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/projects",
  validateSearch: validateProjectsSearch,
  component: function Projects() {
    return <ProjectsPage search={projectsRoute.useSearch()} />;
  },
});

const projectRoute = createRoute({
  getParentRoute: () => appRoute,
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
  getParentRoute: () => appRoute,
  path: "/documents",
  validateSearch: validateDocumentsSearch,
  component: function Documents() {
    return <DocumentsPage search={documentsRoute.useSearch()} />;
  },
});

const documentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/documents/$documentId",
  component: function Document() {
    return <DocumentPage documentId={documentRoute.useParams().documentId} />;
  },
});

const schedulesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/schedules",
  validateSearch: validateSchedulesSearch,
  component: function Schedules() {
    return <SchedulesPage search={schedulesRoute.useSearch()} />;
  },
});

const scheduleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/schedules/$scheduleId",
  component: function ScheduleRoute() {
    const { scheduleId } = scheduleRoute.useParams();
    return <SchedulePage scheduleId={scheduleId} />;
  },
});

const filesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/files",
  validateSearch: validateFilesSearch,
  component: function Files() {
    return <FilesPage search={filesRoute.useSearch()} />;
  },
});

const chatsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/chats",
  validateSearch: validateChatsSearch,
  component: function Chats() {
    return <ChatsLandingPage search={chatsRoute.useSearch()} />;
  },
});

// A new chat: who it is with and its project come in the URL (prefilled).
const newChatRoute = createRoute({
  getParentRoute: () => appRoute,
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
  getParentRoute: () => appRoute,
  path: "/chats/$chatId",
  component: function Chat() {
    return <ChatPage chatId={chatRoute.useParams().chatId} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks",
  validateSearch: validateTasksSearch,
  component: function Tasks() {
    return <TasksPage search={tasksRoute.useSearch()} />;
  },
});

const taskRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tasks/$taskId",
  component: function Task() {
    return <TaskPage taskId={taskRoute.useParams().taskId} />;
  },
});

// Opened from the profile menu, not the rail; "/settings" opens Profile.
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({
      to: "/settings/$section",
      params: { section: "profile" },
    });
  },
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/$section",
  component: function Settings() {
    const { section } = settingsSectionRoute.useParams();
    return isSettingsSection(section) ? (
      <SettingsPage section={section} />
    ) : (
      <NotFound />
    );
  },
});

const agentSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/agents/$agentId",
  component: function AgentSettings() {
    return (
      <AgentSettingsPage agentId={agentSettingsRoute.useParams().agentId} />
    );
  },
});

export const router = createRouter({
  defaultNotFoundComponent: () => <NotFound />,
  routeTree: rootRoute.addChildren([
    publicShareRoute,
    appRoute.addChildren([
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
      settingsSectionRoute,
      agentSettingsRoute,
    ]),
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
