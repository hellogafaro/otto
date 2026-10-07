/**
 * What the palette lists, read live from the app's stores (all local, nothing fetched):
 * Pinned and Recent (the sidebar's pins-recents store), the workspace's chats (the
 * sessions store, newest first, archived last), the pages of the sidebar, every settings
 * page (`SETTINGS_NAV_GROUPS`, with the settings sidebar's icons), the skills and sources
 * the shell loaded, and the actions that make sense from a palette, with their keys.
 * Tasks (not archived), projects (active) and the library come from the same hooks as their pages.
 * Routines have no data yet: they are a page here, nothing more.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { formatDistanceToNowStrict, type Locale } from 'date-fns'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Clock,
  Folder,
  House,
  Library,
  LogOut,
  MessagesSquare,
  Monitor,
  Moon,
  Power,
  Settings,
  SquarePen,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { useActionRegistry, type ActionId } from '@/actions'
import { itemKey, type ResolvedItem } from '@/atoms/pins-recents'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { SETTINGS_ICONS } from '@/components/icons/settings-icons'
import { TaskStatusIcon } from '@/components/tasks/task-status-icon'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { ChatStatusIcon } from '@/config/session-status-config'
import { useAppShellContext } from '@/context/app-shell-context'
import { useTheme, type ThemeMode } from '@/context/theme-context'
import { useNavigation } from '@/contexts/navigation-context'
import { useLibrary } from '@/hooks/use-library'
import { usePins } from '@/hooks/use-pins'
import { useProjects } from '@/hooks/use-projects'
import { useRecents } from '@/hooks/use-recents'
import { useTasks } from '@/hooks/use-tasks'
import { logOut } from '@/lib/log-out'
import { navigate, routes, type Route } from '@/lib/navigate'
import { isWebUI } from '@/lib/platform'
import { getSessionStatus, getSessionTitle, shortTimeLocale } from '@/utils/session'
import { libraryItemIcon } from '@/pages/library/library-tile'
import { getDisplayTitle, MAX_FOLDER_DEPTH } from '@/pages/library/library-items'
import { SETTINGS_NAV_GROUPS } from '../../../shared/menu-schema'
import type { PaletteItem } from './command-palette'
import type { PaletteData } from './palette-model'

/** The sidebar's pages, in its order, with its icons (Home first: its row leads the sidebar). */
const PAGES: { id: string; icon: LucideIcon; labelKey: string; route: () => Route }[] = [
  { id: 'home', icon: House, labelKey: 'sidebar.home', route: () => routes.view.home() },
  { id: 'tasks', icon: CircleCheck, labelKey: 'sidebar.tasks', route: () => routes.view.tasks() },
  { id: 'projects', icon: Folder, labelKey: 'sidebar.projects', route: () => routes.view.projects() },
  { id: 'chats', icon: MessagesSquare, labelKey: 'sidebar.chats', route: () => routes.view.allSessions() },
  { id: 'routines', icon: Clock, labelKey: 'sidebar.routines', route: () => routes.view.automations() },
  { id: 'library', icon: Library, labelKey: 'sidebar.library', route: () => routes.view.library() },
]

/** A pinned or recent item that is not a chat shows its type's icon. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  project: Folder,
  task: CircleCheck,
  routine: Clock,
  library: Library,
  settings: Settings,
}

const THEMES: { mode: ThemeMode; icon: LucideIcon; labelKey: string }[] = [
  { mode: 'light', icon: Sun, labelKey: 'commandPalette.lightTheme' },
  { mode: 'dark', icon: Moon, labelKey: 'commandPalette.darkTheme' },
  { mode: 'system', icon: Monitor, labelKey: 'commandPalette.systemTheme' },
]

const go = (route: Route) => () => navigate(route)

export function usePaletteData(): PaletteData<PaletteItem> {
  const { t } = useTranslation()
  const { workspaces, activeWorkspaceId, sessionStatuses = [] } = useAppShellContext()
  const sessions = useAtomValue(sessionMetaMapAtom)
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const { tasks } = useTasks()
  const { projects } = useProjects()
  const { items: libraryItems } = useLibrary()
  const { pinned } = usePins()
  const recent = useRecents()
  const { execute, getHotkeyDisplay } = useActionRegistry()
  const { mode, setMode } = useTheme()
  const { canGoBack, canGoForward } = useNavigation()

  const remoteWorkspaceId = workspaces.find((w) => w.id === activeWorkspaceId)?.remoteServer?.remoteWorkspaceId

  return React.useMemo(() => {
    const chatItem = (session: SessionMeta): PaletteItem => ({
      key: itemKey({ type: 'chat', id: session.id }),
      title: getSessionTitle(session),
      icon: <ChatStatusIcon id={getSessionStatus(session)} statuses={sessionStatuses} />,
      meta: session.lastMessageAt
        ? formatDistanceToNowStrict(new Date(session.lastMessageAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })
        : undefined,
      run: go(routes.view.allSessions(session.id)),
    })
    const navItem = (item: ResolvedItem): PaletteItem => {
      if (item.session) return chatItem(item.session)
      const Icon = TYPE_ICONS[item.type] ?? Folder
      return { key: itemKey(item), title: item.title, icon: <Icon />, run: go(item.route) }
    }
    const action = (key: string, Icon: LucideIcon, title: string, run: () => void, actionId?: ActionId): PaletteItem => ({
      key: `action:${key}`,
      title,
      icon: <Icon />,
      hotkey: actionId ? getHotkeyDisplay(actionId) : undefined,
      run,
    })

    // The workspace's chats (a remote workspace's carry the remote id), newest first, archived last.
    const chats = Array.from(sessions.values())
      .filter((s) => !activeWorkspaceId || s.workspaceId === activeWorkspaceId || (!!remoteWorkspaceId && s.workspaceId === remoteWorkspaceId))
      .sort((a, b) => Number(!!a.isArchived) - Number(!!b.isArchived) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .map(chatItem)

    // Archived tasks and projects are left out: they are found on their pages (Archived filter).
    const projectTitles = new Map(projects.map((project) => [project.id, project.title]))
    const foldersById = new Map(libraryItems.filter((item) => item.type === 'folder').map((folder) => [folder.id, folder]))
    const folderPath = (parentId: string | null) => {
      const names: string[] = []
      for (let id = parentId; id && names.length < MAX_FOLDER_DEPTH; ) {
        const folder = foldersById.get(id)
        if (!folder) break
        names.unshift(folder.title)
        id = folder.parentId
      }
      return names.join(' / ') || undefined
    }

    const settings = SETTINGS_NAV_GROUPS.flatMap((group) => group.items).map((page): PaletteItem => {
      const Icon = SETTINGS_ICONS[page.id]
      return {
        key: itemKey({ type: 'settings', id: page.id }),
        title: t(page.labelKey),
        keywords: [t('sidebar.settings')],
        icon: <Icon />,
        // The Shortcuts page is also where ⌘/ goes.
        hotkey: page.id === 'shortcuts' ? getHotkeyDisplay('app.keyboardShortcuts') : undefined,
        run: go(routes.view.settings(page.id)),
      }
    })

    const actions: PaletteItem[] = [
      action('newChat', SquarePen, t('menu.newChat'), () => execute('app.newChat'), 'app.newChat'),
      action('settings', Settings, t('commandPalette.openSettings'), () => execute('app.settings'), 'app.settings'),
      ...THEMES.map(({ mode: value, icon, labelKey }) => ({
        ...action(`theme-${value}`, icon, t(labelKey), () => setMode(value)),
        checked: mode === value,
      })),
      ...(canGoBack ? [action('back', ArrowLeft, t('commandPalette.goBack'), () => execute('nav.goBack'), 'nav.goBack')] : []),
      ...(canGoForward ? [action('forward', ArrowRight, t('commandPalette.goForward'), () => execute('nav.goForward'), 'nav.goForward')] : []),
      // The web app ends its session; the desktop app quits (it has no session to end).
      isWebUI
        ? action('logOut', LogOut, t('workspaceMenu.logOut'), () => void logOut())
        : action('quit', Power, t('menu.quitProduct'), () => execute('app.quit'), 'app.quit'),
    ]

    return {
      pinned: pinned.map(navItem),
      recent: recent.map(navItem),
      chats,
      tasks: tasks
        .filter((task) => task.status !== 'archived')
        .map((task): PaletteItem => ({
          key: itemKey({ type: 'task', id: task.id }),
          title: task.title,
          icon: <TaskStatusIcon status={task.status} />,
          meta: projectTitles.get(task.projectId),
          run: go(routes.view.tasks({ taskId: task.id })),
        })),
      projects: projects
        .filter((project) => project.status === 'active')
        .map((project): PaletteItem => ({
          key: itemKey({ type: 'project', id: project.id }),
          title: project.title,
          icon: <Folder />,
          run: go(routes.view.projects({ projectId: project.id })),
        })),
      library: libraryItems.map((item): PaletteItem => {
        const Icon = libraryItemIcon(item.type)
        return {
          key: itemKey({ type: 'library', id: item.id }),
          title: getDisplayTitle(item),
          icon: <Icon />,
          meta: folderPath(item.parentId),
          run: go(item.type === 'folder' ? routes.view.library({ folder: item.id }) : routes.view.library({ itemId: item.id })),
        }
      }),
      pages: PAGES.map(({ id, icon: Icon, labelKey, route }) => ({
        key: `page:${id}`,
        title: t(labelKey),
        icon: <Icon />,
        run: go(route()),
      })),
      settings,
      skills: (skills ?? []).map((skill) => ({
        key: `skill:${skill.slug}`,
        title: skill.metadata.name,
        icon: <SkillAvatar skill={skill} size="xs" bare workspaceId={activeWorkspaceId ?? undefined} />,
        run: go(routes.view.skills({ skillSlug: skill.slug })),
      })),
      sources: (sources ?? []).map((source) => ({
        key: `source:${source.config.slug}`,
        title: source.config.name,
        icon: <SourceAvatar source={source} size="xs" bare />,
        run: go(routes.view.sources({ sourceSlug: source.config.slug })),
      })),
      actions,
    }
  }, [t, sessions, activeWorkspaceId, remoteWorkspaceId, sessionStatuses, tasks, projects, libraryItems, pinned, recent, skills, sources, execute, getHotkeyDisplay, mode, setMode, canGoBack, canGoForward])
}
