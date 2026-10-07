/**
 * The composer's `/` commands and `@` mentions (the chat input's machinery, kept): what the toolbar pickers did
 * is a command now (DESIGN.md, Composer, Commands). `/` offers Add files everywhere and, in a chat, its mode
 * (Explore, Ask, Execute), its status, its working directory (a recent one or Choose folder) and Compact; `@`
 * mentions people, agents, tasks and projects (their entity tokens, drawn as chips; a chat's members first), skills, sources and the working
 * directory's files. The menus are portaled out of the composer (its
 * blurred glass would hold and clip a fixed menu).
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { atom, useAtomValue } from 'jotai'
import { FolderOpen, Minimize2, Paperclip } from 'lucide-react'
import { InlineMentionMenu, useInlineMention } from '@/components/ui/mention-menu'
import { describeEntity } from '@/components/entities/entity-tokens'
import { useEntityLabel, useEntityLists } from '@/components/entities/entity-chip'
import { useAgents } from '@/hooks/use-agents'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useWorkspaceMemberList, useWorkspaceMembers } from '@/hooks/use-workspace-members'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { otherMembers } from '@/lib/actors'
import { buildEntitySections } from './mention-entities'
import { InlineSlashCommand, PermissionModeIcon, useInlineSlashCommand, type SlashSection } from '@/components/ui/slash-command-menu'
import type { RichTextInputHandle } from '@/components/ui/rich-text-input'
import { getStatusIconStyle } from '@/config/session-status-config'
import { ServerDirectoryBrowser } from '@/components/server-directory-browser'
import { useAppShellContext } from '@/context/app-shell-context'
import { useAvailablePermissionModes } from '@/hooks/use-available-permission-modes'
import { useDirectoryPicker } from '@/hooks/use-directory-picker'
import { addRecentWorkingDir, getRecentWorkingDirs } from '@/components/app-shell/input/working-directory-history'
import { getPathBasename } from '@/lib/platform'
import type { ComposerContext } from './composer-state'

const ICON = 'size-3.5'

export function useComposerCommands({
  inputRef,
  context,
  setText,
  onAddFiles,
}: {
  inputRef: React.RefObject<RichTextInputHandle | null>
  context: ComposerContext | null
  setText: (text: string) => void
  onAddFiles: () => void
}) {
  const { t } = useTranslation()
  const { skills = [], enabledSources = [], sessionStatuses = [], activeWorkspaceId, activeWorkspaceSlug } = useAppShellContext()
  const commands = context?.commands
  const modes = useAvailablePermissionModes(commands?.permissionMode)
  const [recentFolders, setRecentFolders] = React.useState<string[]>([])
  const [homeDir, setHomeDir] = React.useState('')
  React.useEffect(() => {
    setRecentFolders(getRecentWorkingDirs(activeWorkspaceId ?? undefined))
    window.electronAPI?.getHomeDir?.().then((dir) => setHomeDir(dir ?? '')).catch(() => {})
  }, [activeWorkspaceId])

  const focus = () => requestAnimationFrame(() => inputRef.current?.focus())
  const chooseFolder = (path: string) => {
    if (!commands?.onWorkingDirectoryChange) return
    setRecentFolders(addRecentWorkingDir(path, activeWorkspaceId ?? undefined))
    commands.onWorkingDirectoryChange(path)
  }
  const picker = useDirectoryPicker(chooseFolder)

  const sections = React.useMemo((): SlashSection[] => {
    const result: SlashSection[] = []
    if (commands?.onPermissionModeChange) {
      result.push({
        id: 'modes',
        label: t('composer.command.mode'),
        items: modes.map((mode) => ({
          id: `mode:${mode}`,
          label: t(`mode.${mode}`),
          icon: <PermissionModeIcon mode={mode} className={ICON} />,
          active: commands.permissionMode === mode,
        })),
      })
    }
    if (commands?.onStatusChange && sessionStatuses.length > 0) {
      result.push({
        id: 'status',
        label: t('composer.command.status'),
        items: sessionStatuses.map((status) => ({
          id: `status:${status.id}`,
          label: status.label,
          icon: <span className="flex" style={getStatusIconStyle(status)}>{status.icon}</span>,
          active: commands.status === status.id,
        })),
      })
    }
    if (commands?.onWorkingDirectoryChange) {
      result.push({
        id: 'folders',
        label: t('composer.command.folder'),
        items: [
          { id: 'folder', label: t('composer.command.chooseFolder'), icon: <FolderOpen className={ICON} /> },
          ...[...recentFolders]
            .sort((a, b) => getPathBasename(a).localeCompare(getPathBasename(b)))
            .map((path) => ({
              id: path,
              type: 'folder' as const,
              label: getPathBasename(path),
              description: homeDir && path.startsWith(homeDir) ? `~${path.slice(homeDir.length)}` : path,
              path,
            })),
        ],
      })
    }
    result.push({
      id: 'commands',
      label: t('composer.command.commands'),
      items: [
        { id: 'files', label: t('composer.addFiles'), icon: <Paperclip className={ICON} /> },
        ...(commands?.onCompact ? [{ id: 'compact', label: t('composer.command.compact'), icon: <Minimize2 className={ICON} /> }] : []),
      ],
    })
    return result
  }, [t, commands, modes, sessionStatuses, recentFolders, homeDir])

  const slash = useInlineSlashCommand({ inputRef, sections })

  // People, agents, tasks and projects from the lists the app keeps loaded; the chip in the text reads the same lists.
  const people = useWorkspaceMemberList()
  const { agents, loaded: agentsLoaded } = useAgents()
  const { tasks, loaded: tasksLoaded } = useTasks()
  const { projects, loaded: projectsLoaded } = useProjects()
  // In a chat, its members (never you) lead the menu.
  const sessionId = context?.sessionId
  const chatMembers = useAtomValue(React.useMemo(() => atom((get) => (sessionId ? get(sessionMetaMapAtom).get(sessionId)?.members : undefined)), [sessionId]))
  const { me } = useWorkspaceMembers()
  const entities = React.useMemo(
    () => buildEntitySections({ people: people.loaded ? people.items : null, agents: agentsLoaded ? agents : null, tasks: tasksLoaded ? tasks : null, projects: projectsLoaded ? projects : null, members: otherMembers(chatMembers, me) }, t),
    [people.loaded, people.items, agents, agentsLoaded, tasks, tasksLoaded, projects, projectsLoaded, chatMembers, me, t],
  )
  const entityLists = useEntityLists()
  const entityLabel = useEntityLabel()
  const mention = useInlineMention({
    inputRef,
    skills,
    sources: enabledSources,
    entities,
    basePath: context?.workingDirectory,
    onSelect: () => {},
    // Skills are qualified with the workspace slug, as the agent resolves them.
    workspaceId: activeWorkspaceSlug ?? activeWorkspaceId ?? undefined,
  })

  const runCommand = (id: string) => {
    setText(slash.removeTrigger())
    if (id.startsWith('mode:')) commands?.onPermissionModeChange?.(id.slice(5) as never)
    else if (id.startsWith('status:')) commands?.onStatusChange?.(id.slice(7))
    else if (id === 'folder') picker.pickDirectory()
    else if (id === 'compact') commands?.onCompact?.()
    else if (id === 'files') onAddFiles()
    focus()
  }

  // The menus open above the composer, never over its rail or text.
  const above = (position: { x: number; y: number }) => {
    const top = inputRef.current?.element?.closest('[data-slot=composer]')?.getBoundingClientRect().top
    return top === undefined ? position : { x: position.x, y: Math.min(position.y, top) }
  }

  const menus = createPortal(
    <>
      <InlineSlashCommand
        open={slash.isOpen}
        onOpenChange={(open) => !open && slash.close()}
        sections={sections}
        onSelectCommand={runCommand}
        onSelectFolder={(path) => {
          setText(slash.removeTrigger())
          chooseFolder(path)
          focus()
        }}
        filter={slash.filter}
        position={above(slash.position)}
      />
      <InlineMentionMenu
        open={mention.isOpen}
        onOpenChange={(open) => !open && mention.close()}
        sections={mention.sections}
        onSelect={(item) => {
          const { value, cursorPosition } = mention.handleSelect(item)
          setText(value)
          setTimeout(() => {
            inputRef.current?.focus()
            inputRef.current?.setSelectionRange(cursorPosition, cursorPosition)
          }, 0)
        }}
        filter={mention.filter}
        position={above(mention.position)}
        workspaceId={activeWorkspaceId ?? undefined}
        maxWidth={280}
        isSearching={mention.isSearching}
      />
      {picker.showServerBrowser && (
        <ServerDirectoryBrowser
          open
          mode={picker.serverBrowserMode}
          onSelect={picker.confirmServerBrowser}
          onCancel={picker.cancelServerBrowser}
        />
      )}
    </>,
    document.body,
  )

  return {
    skills,
    sources: enabledSources,
    workspaceSlug: activeWorkspaceSlug ?? activeWorkspaceId ?? undefined,
    menus,
    /** The text of an entity token in the editor: the live title, from the lists the chips read. */
    entityLabel: (token: string) => {
      const info = describeEntity(token, entityLists)
      return info ? entityLabel(info) : token
    },
    /** Feed every edit (with the caret) to both menus. */
    onInput: (value: string, cursor: number) => {
      slash.handleInputChange(value, cursor)
      mention.handleInputChange(value, cursor)
    },
    /** True when an open menu takes this key (it moves, picks or closes). */
    takesKey: (event: React.KeyboardEvent) => {
      const menuKey = ['Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)
      const mentionShown = mention.isOpen && (mention.hasItems || mention.isSearching)
      if ((mentionShown || slash.isOpen) && menuKey) return true
      if (event.key === 'Escape' && (mention.isOpen || slash.isOpen)) {
        event.preventDefault()
        mention.close()
        slash.close()
        return true
      }
      return false
    },
    menuOpen: mention.isOpen || slash.isOpen,
  }
}
