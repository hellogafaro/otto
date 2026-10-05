import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Plus } from "lucide-react"
import { Spinner } from "@otto/ui"
import { slugify } from "@/lib/slugify"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { StepFormLayout, BackButton, ContinueButton } from "../onboarding/primitives"

const CREATE_NEW_VALUE = '__create_new__'

interface AddWorkspaceStep_ConnectRemoteProps {
  onBack: () => void
  onCreate: (folderPath: string, name: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => Promise<void>
  isCreating: boolean
  /** Pre-fill the server URL (for reconnect flow) */
  initialUrl?: string
  /** Pre-fill the token (for reconnect flow) */
  initialToken?: string
  /** When set, updating an existing workspace's remote config instead of creating */
  reconnectWorkspace?: { id: string; name: string; remoteWorkspaceId: string }
  /** Called when reconnect updates the remote server config */
  onUpdate?: (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => Promise<void>
}

/**
 * Resolve a unique local workspace slug by appending suffixes if needed.
 * Tries: baseName → baseName-remote → baseName-2 → baseName-3 → ...
 */
async function resolveUniqueSlug(baseName: string): Promise<{ slug: string; path: string }> {
  const baseSlug = slugify(baseName)
  if (!baseSlug) return { slug: 'remote', path: '' }

  let slug = baseSlug
  let attempt = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await window.electronAPI.checkWorkspaceSlug(slug)
    if (!result.exists) {
      return { slug, path: result.path }
    }
    attempt++
    slug = attempt === 1 ? `${baseSlug}-remote` : `${baseSlug}-${attempt}`
    if (attempt > 20) {
      // Safety valve — shouldn't happen in practice
      return { slug: `${baseSlug}-${Date.now()}`, path: result.path.replace(baseSlug, `${baseSlug}-${Date.now()}`) }
    }
  }
}

/**
 * AddWorkspaceStep_ConnectRemote - Connect to a remote Otto Server
 *
 * Two paths:
 * 1. Connect to existing workspace — select from dropdown, no name needed, auto-resolve local slug
 * 2. Create new workspace — type a name, creates on server, then connects
 */
export function AddWorkspaceStep_ConnectRemote({
  onBack,
  onCreate,
  isCreating,
  initialUrl,
  initialToken,
  reconnectWorkspace,
  onUpdate,
}: AddWorkspaceStep_ConnectRemoteProps) {
  const { t } = useTranslation()
  const isReconnectMode = !!reconnectWorkspace
  const [serverUrl, setServerUrl] = useState(initialUrl ?? '')
  const [token, setToken] = useState(initialToken ?? '')
  const [homeDir, setHomeDir] = useState('')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [remoteWorkspaces, setRemoteWorkspaces] = useState<Array<{ id: string; name: string }>>([])
  const [selectedValue, setSelectedValue] = useState<string | null>(null) // workspace ID or CREATE_NEW_VALUE
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [serverVersion, setServerVersion] = useState<string | null>(null)
  const selectPortalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.getHomeDir().then(setHomeDir)
  }, [])

  const isCreateNew = selectedValue === CREATE_NEW_VALUE
  const selectedWorkspace = !isCreateNew ? remoteWorkspaces.find(w => w.id === selectedValue) : null
  // Fresh server (no workspaces at all) — always in create mode
  const isFreshServer = testState === 'ok' && remoteWorkspaces.length === 0

  // Reset test state when URL or token changes
  useEffect(() => {
    setTestState('idle')
    setTestError(null)
    setRemoteWorkspaces([])
    setSelectedValue(null)
    setNewWorkspaceName('')
  }, [serverUrl, token])

  const handleTestConnection = useCallback(async () => {
    if (!serverUrl || !token) return
    setTestState('testing')
    setTestError(null)
    try {
      const result = await window.electronAPI.testRemoteConnection(serverUrl, token)
      console.log('[ConnectRemote] testRemoteConnection result:', JSON.stringify(result, null, 2))
      if (result.ok) {
        setTestState('ok')
        setServerVersion(result.serverVersion ?? null)
        if (result.needsWorkspace) {
          // Fresh server — no workspaces, go straight to create mode
          setRemoteWorkspaces([])
          setSelectedValue(null)
        } else {
          const workspaces = result.remoteWorkspaces ?? []
          setRemoteWorkspaces(workspaces)
          if (workspaces.length === 1) {
            setSelectedValue(workspaces[0]!.id)
          }
        }
      } else {
        setTestState('error')
        setTestError(result.error || 'Connection failed')
      }
    } catch (err) {
      setTestState('error')
      setTestError(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [serverUrl, token])

  const handleConnect = useCallback(async () => {
    if (!serverUrl || !token) return

    // Reconnect mode — update existing workspace config
    if (isReconnectMode && onUpdate) {
      try {
        await onUpdate(reconnectWorkspace!.id, {
          url: serverUrl,
          token,
          remoteWorkspaceId: reconnectWorkspace!.remoteWorkspaceId,
        })
        return
      } catch (err) {
        setTestState('error')
        setTestError(err instanceof Error ? err.message : 'Failed to reconnect workspace')
        return
      }
    }

    if (!homeDir) return
    const defaultBasePath = `${homeDir}/.otto/workspaces`

    if (isCreateNew || isFreshServer) {
      // Create new workspace on remote server via direct RPC, then connect locally
      const name = newWorkspaceName.trim()
      if (!name) return

      try {
        const created = await window.electronAPI.invokeOnServer(
          serverUrl, token, 'server:createWorkspace', name
        ) as { id: string; name: string }

        const { slug, path } = await resolveUniqueSlug(name)
        const finalPath = path || `${defaultBasePath}/${slug}`
        await onCreate(finalPath, name, { url: serverUrl, token, remoteWorkspaceId: created.id })
      } catch (err) {
        setTestState('error')
        setTestError(err instanceof Error ? err.message : 'Failed to create workspace on remote server')
        return
      }
    } else if (selectedWorkspace) {
      // Connect to existing workspace — auto-resolve local slug
      const { slug, path } = await resolveUniqueSlug(selectedWorkspace.name)
      const finalPath = path || `${defaultBasePath}/${slug}`
      await onCreate(finalPath, selectedWorkspace.name, { url: serverUrl, token, remoteWorkspaceId: selectedWorkspace.id })
    }
  }, [serverUrl, token, homeDir, isCreateNew, isFreshServer, newWorkspaceName, selectedWorkspace, onCreate, isReconnectMode, onUpdate, reconnectWorkspace])

  const canConnect = testState === 'ok' && !isCreating && (
    isReconnectMode ? true :
    (isFreshServer || isCreateNew) ? !!newWorkspaceName.trim() : !!selectedWorkspace
  )

  const showCreateMode = !isReconnectMode && (isCreateNew || isFreshServer)
  const buttonLabel = isReconnectMode ? 'Reconnect' : showCreateMode ? 'Create and Connect' : 'Connect'

  return (
    <StepFormLayout
      title={isReconnectMode ? t("workspace.reconnect", { name: reconnectWorkspace!.name }) : "Connect to remote server"}
      description={isReconnectMode
        ? "Update the server URL or token to restore the connection."
        : "Connect to a remote Otto Server for this workspace."}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isCreating}>{t("common.back")}</BackButton>
          {/* Connect / Create and Connect */}
          <ContinueButton onClick={handleConnect} disabled={!canConnect} loading={isCreating}>
            {buttonLabel}
          </ContinueButton>
        </>
      }
    >
      <div className="space-y-3">
        <SettingsCard>
          {/* Server URL */}
          <SettingsRow label={<Label htmlFor="remote-server-url">Server URL</Label>}>
            <Input
              id="remote-server-url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://192.168.1.100:9100"
              disabled={isCreating}
              autoFocus
              className="w-60 font-mono"
            />
          </SettingsRow>

          {/* Token */}
          <SettingsRow label={<Label htmlFor="remote-server-token">Token</Label>}>
            <Input
              id="remote-server-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("workspace.serverAuthToken")}
              disabled={isCreating}
              className="w-60"
            />
          </SettingsRow>
        </SettingsCard>

        {/* Test Connection */}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={handleTestConnection}
          disabled={!serverUrl || !token || testState === 'testing' || isCreating}
        >
          {testState === 'testing' ? <Spinner /> : 'Test Connection'}
        </Button>
        {testState === 'ok' && (
          <p className="px-1 text-sm text-success">
            Connected{serverVersion ? ` — v${serverVersion}` : ''}{isFreshServer ? ' — no workspaces yet' : ''}
          </p>
        )}
        {testState === 'error' && (
          <p className="px-1 text-sm text-destructive">{testError || 'Failed'}</p>
        )}

        {/* Old server warning */}
        {testState === 'ok' && !serverVersion && (
          <p className="px-1 text-sm text-muted-foreground">{t("workspace.olderServerWarning")}</p>
        )}

        {/* Portal container for Select — must be inside the Dialog to receive pointer events */}
        <div ref={selectPortalRef} />

        {/* Workspace selector — pick existing or create new (hidden in reconnect mode) */}
        {!isReconnectMode && testState === 'ok' && remoteWorkspaces.length > 0 && !isCreateNew && (
          <>
            <SettingsCard>
              <SettingsRow label="Workspace">
                <Select
                  value={selectedValue ?? ''}
                  onValueChange={setSelectedValue}
                  disabled={isCreating}
                >
                  <SelectTrigger className="w-60">
                    <SelectValue placeholder={t("workspace.selectWorkspacePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent container={selectPortalRef.current}>
                    {remoteWorkspaces.map(ws => (
                      <SelectItem key={ws.id} value={ws.id}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>
            </SettingsCard>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setSelectedValue(CREATE_NEW_VALUE)}
              disabled={isCreating}
            >
              <Plus />
              Create new workspace on server
            </Button>
          </>
        )}

        {/* New workspace name — shown for fresh servers or "Create new" selection (hidden in reconnect mode) */}
        {!isReconnectMode && testState === 'ok' && showCreateMode && (
          <>
            <SettingsCard>
              <SettingsRow label={<Label htmlFor="remote-workspace-name">Workspace name</Label>}>
                <Input
                  id="remote-workspace-name"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder={t("workspace.myRemoteWorkspace")}
                  disabled={isCreating}
                  className="w-60"
                />
              </SettingsRow>
            </SettingsCard>
            <p className="px-1 text-xs text-muted-foreground">
              A workspace will be created on the remote server with this name.
            </p>
            {isCreateNew && remoteWorkspaces.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setSelectedValue(remoteWorkspaces.length === 1 ? remoteWorkspaces[0]!.id : null)
                  setNewWorkspaceName('')
                }}
                disabled={isCreating}
              >
                <ArrowLeft />
                Use existing workspace
              </Button>
            )}
          </>
        )}
      </div>
    </StepFormLayout>
  )
}
