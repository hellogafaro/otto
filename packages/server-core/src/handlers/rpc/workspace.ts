import { existsSync } from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'path'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces, addWorkspace, removeWorkspace, setActiveWorkspace, updateWorkspaceRemoteServer } from '@otto/shared/config'
import { domainError, perf } from '@otto/shared/utils'
import { userActor } from '@otto/shared/actors'
import { getDefaultProvider, initAgentsSeed } from '@otto/shared/agents'
import { initLabelsStatusesImport } from '@otto/shared/labels/import'
import { initSkills } from '@otto/shared/skills'
import { initSources } from '@otto/shared/sources'
import { createWorkspaceMember, getMemberWorkspaceIds } from '@otto/shared/workspaces'
import { assertOwner } from '../../bootstrap/authorize'
import { pushTyped, type RpcServer } from '@otto/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { isValidWorkspaceRootPath } from '../../utils/path-validation'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.REMOVE,
  RPC_CHANNELS.workspaces.CHECK_SLUG,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,
  RPC_CHANNELS.window.GET_WORKSPACE,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.workspace.READ_IMAGE,
  RPC_CHANNELS.workspace.WRITE_IMAGE,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.toolIcons.GET_MAPPINGS,
  RPC_CHANNELS.logo.GET_URL,
] as const

export function registerWorkspaceCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps

  // Get the caller's workspaces (with rootPath: the desktop's windows show it)
  server.handle(RPC_CHANNELS.workspaces.GET, async (ctx) => {
    const mine = new Set(ctx.userId ? getMemberWorkspaceIds(ctx.userId) : [])
    return sessionManager.getWorkspaces().filter((workspace) => mine.has(workspace.id))
  })

  // Create a new workspace at a folder path (Obsidian-style: folder IS the workspace).
  // Any signed-in user may; the creator becomes its owner. Only the desktop's own server (OTTO_LOCAL_USER: one person,
  // their own disk) takes any folder; every other server creates under CONFIG_DIR/workspaces, so a client never picks
  // a path on the server's disk.
  server.handle(RPC_CHANNELS.workspaces.CREATE, async (ctx, folderPath: string, name: string, remoteServer?: { url: string; token: string; remoteWorkspaceId: string }) => {
    if (!ctx.userId) throw domainError('forbidden', 'Sign in first')
    const rootPath = folderPath.trim()
    const validation = isValidWorkspaceRootPath(rootPath)
    if (!validation.valid) {
      throw new Error(validation.reason!)
    }
    if (process.env.OTTO_LOCAL_USER !== '1') {
      const inside = relative(join(CONFIG_DIR, 'workspaces'), resolve(rootPath))
      if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw domainError('invalid', 'Workspaces are created inside the server\'s workspaces folder')
    }
    // A folder that is already a workspace is updated, not taken over: only its owner may.
    const existing = getWorkspaces().find((workspace) => workspace.rootPath === rootPath)
    if (existing) assertOwner(ctx.userId, existing.id)

    const workspace = addWorkspace({ name, rootPath, ...(remoteServer && { remoteServer }) })
    initLabelsStatusesImport() // the new workspace's labels and statuses
    if (!existing) createWorkspaceMember(workspace.id, ctx.userId, 'owner')
    await initSkills() // the skills of a folder that already had some, made by its owner
    await initSources() // and its sources, with the credentials they had
    initAgentsSeed(workspace.id, userActor(ctx.userId), getDefaultProvider(workspace.id, ctx.userId)) // its first agent
    // Make it active
    setActiveWorkspace(workspace.id, ctx.userId)
    deps.platform.logger.info(`Created workspace "${name}" at ${rootPath}${remoteServer ? ` (remote: ${remoteServer.url})` : ''}`)
    return workspace
  })

  // Take a workspace out of the registry (its folder stays; its data under CONFIG_DIR/workspaces goes). Owners only (authorize.ts).
  server.handle(RPC_CHANNELS.workspaces.REMOVE, async (_ctx, workspaceId: string) => removeWorkspace(workspaceId))

  // Check if a workspace slug already exists (for validation before creation)
  server.handle(RPC_CHANNELS.workspaces.CHECK_SLUG, async (_ctx, slug: string) => {
    const defaultWorkspacesDir = join(CONFIG_DIR, 'workspaces')
    const workspacePath = join(defaultWorkspacesDir, slug)
    const exists = existsSync(workspacePath)
    return { exists, path: workspacePath }
  })

  // Update remote server config for an existing workspace (reconnect flow)
  server.handle(RPC_CHANNELS.workspaces.UPDATE_REMOTE, async (_ctx, workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => {
    updateWorkspaceRemoteServer(workspaceId, remoteServer)
    deps.platform.logger.info(`Updated remote server for workspace ${workspaceId}: ${remoteServer.url}`)
    return { success: true }
  })

  // The workspace of the calling window: its connection's
  server.handle(RPC_CHANNELS.window.GET_WORKSPACE, (ctx) => {
    const workspaceId = ctx.workspaceId
    // Set up ConfigWatcher for live updates (labels, statuses, sources, themes)
    if (workspaceId) {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (workspace) {
        sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
      }
    }
    return workspaceId
  })

  // Switch workspace in current window (in-window switching)
  server.handle(RPC_CHANNELS.window.SWITCH_WORKSPACE, async (ctx, workspaceId: string) => {
    const end = perf.start('ipc.switchWorkspace', { workspaceId })

    // Keep WS push routing in sync (the desktop's main process keeps its own window-to-workspace map)
    server.updateClientWorkspace?.(ctx.clientId, workspaceId)

    // Set up ConfigWatcher for the new workspace
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (workspace) {
      sessionManager.setupConfigWatcher(workspace.rootPath, workspaceId)
    }
    end()

    // Return connection details so the preload RoutedClient can decide
    // whether to connect directly to a remote server for this workspace.
    return {
      workspaceId,
      remoteServer: workspace?.remoteServer ?? null,
    }
  })

  // ============================================================
  // Workspace Image Read/Write
  // ============================================================

  // Generic workspace image loading (for source icons, status icons, etc.)
  server.handle(RPC_CHANNELS.workspace.READ_IMAGE, async (_ctx, workspaceId: string, relativePath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { readFileSync, existsSync } = await import('fs')
    const { join, normalize } = await import('path')

    // Security: validate path
    // - Must not contain .. (path traversal)
    // - Must be a valid image extension
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    if (!existsSync(absolutePath)) {
      return null  // Missing optional files - silent fallback to default icons
    }

    // Read file as buffer
    const buffer = readFileSync(absolutePath)

    // If SVG, return as UTF-8 string (caller will use as innerHTML)
    if (ext === '.svg') {
      return buffer.toString('utf-8')
    }

    // For binary images, return as data URL
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.gif': 'image/gif',
    }
    const mimeType = mimeTypes[ext] || 'image/png'
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  })

  // Generic workspace image writing (for workspace icon, etc.)
  // Resizes images to max 256x256 to keep file sizes small
  server.handle(RPC_CHANNELS.workspace.WRITE_IMAGE, async (_ctx, workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { writeFileSync, unlinkSync, readdirSync } = await import('fs')
    const { join, normalize, basename } = await import('path')

    // Security: validate path
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    // If this is an icon file (icon.*), delete any existing icon files with different extensions
    const fileName = basename(relativePath)
    if (fileName.startsWith('icon.')) {
      const files = readdirSync(workspace.rootPath)
      for (const file of files) {
        if (file.startsWith('icon.') && file !== fileName) {
          const oldPath = join(workspace.rootPath, file)
          try {
            unlinkSync(oldPath)
          } catch {
            // Ignore errors deleting old icon
          }
        }
      }
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(base64, 'base64')

    // For SVGs, just write directly (no resizing needed)
    if (mimeType === 'image/svg+xml' || ext === '.svg') {
      writeFileSync(absolutePath, buffer)
      return
    }

    // For raster images, resize to max 256x256
    const metadata = await deps.platform.imageProcessor.getMetadata(buffer)
    const width = metadata?.width ?? 0
    const height = metadata?.height ?? 0

    // Only resize if larger than 256px
    if (width > 256 || height > 256) {
      const resized = await deps.platform.imageProcessor.process(buffer, {
        resize: { width: 256, height: 256 },
        format: 'png',
      })
      writeFileSync(absolutePath, resized)
    } else {
      // Small enough, write as-is
      writeFileSync(absolutePath, buffer)
    }
  })

  // ============================================================
  // Theme (app-level only)
  // ============================================================

  server.handle(RPC_CHANNELS.theme.GET_APP, async () => {
    const { loadAppTheme } = await import('@otto/shared/config/storage')
    return loadAppTheme()
  })

  // Preset themes (app-level)
  server.handle(RPC_CHANNELS.theme.GET_PRESETS, async () => {
    const { loadPresetThemes } = await import('@otto/shared/config/storage')
    return loadPresetThemes()
  })

  server.handle(RPC_CHANNELS.theme.LOAD_PRESET, async (_ctx, themeId: string) => {
    const { loadPresetTheme } = await import('@otto/shared/config/storage')
    return loadPresetTheme(themeId)
  })

  server.handle(RPC_CHANNELS.theme.GET_COLOR_THEME, async (ctx) => {
    const { getColorTheme } = await import('@otto/shared/config/storage')
    return getColorTheme(ctx.userId)
  })

  server.handle(RPC_CHANNELS.theme.SET_COLOR_THEME, async (ctx, themeId: string) => {
    const { setColorTheme } = await import('@otto/shared/config/storage')
    setColorTheme(themeId, ctx.userId)
  })

  // Broadcast theme preferences to all other windows (for cross-window sync)
  server.handle(RPC_CHANNELS.theme.BROADCAST_PREFERENCES, async (ctx, preferences: { mode: string; colorTheme: string }) => {
    pushTyped(server, RPC_CHANNELS.theme.PREFERENCES_CHANGED, { to: 'all' }, preferences)
  })

  // ============================================================
  // Tool Icons and Logo
  // ============================================================

  // Tool icon mappings — loads tool-icons.json and resolves each entry's icon to a data URL
  // for display in the Appearance settings page
  server.handle(RPC_CHANNELS.toolIcons.GET_MAPPINGS, async () => {
    const { getToolIconsDir } = await import('@otto/shared/config/storage')
    const { loadToolIconConfig } = await import('@otto/shared/utils/cli-icon-resolver')
    const { encodeIconToDataUrl } = await import('@otto/shared/utils/icon-encoder')
    const { join } = await import('path')

    const toolIconsDir = getToolIconsDir()
    const config = loadToolIconConfig(toolIconsDir)
    if (!config) return []

    return config.tools
      .map(tool => {
        const iconPath = join(toolIconsDir, tool.icon)
        const iconDataUrl = encodeIconToDataUrl(iconPath)
        if (!iconDataUrl) return null
        return {
          id: tool.id,
          displayName: tool.displayName,
          iconDataUrl,
          commands: tool.commands,
        }
      })
      .filter(Boolean)
  })

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  server.handle(RPC_CHANNELS.logo.GET_URL, async (_ctx, serviceUrl: string, provider?: string) => {
    const { getLogoUrl } = await import('@otto/shared/utils/logo')
    const result = getLogoUrl(serviceUrl, provider)
    return result
  })
}
