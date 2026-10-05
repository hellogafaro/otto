import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { motion } from "motion/react"
import { FullscreenOverlayBase } from "@craft-agent/ui"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { overlayTransitionIn } from "@/lib/animations"
import { AddWorkspaceStep_Choice } from "./AddWorkspaceStep_Choice"
import { AddWorkspaceStep_CreateNew } from "./AddWorkspaceStep_CreateNew"
import { AddWorkspaceStep_OpenFolder } from "./AddWorkspaceStep_OpenFolder"
import { AddWorkspaceStep_ConnectRemote } from "./AddWorkspaceStep_ConnectRemote"
import { AddWorkspacePage } from "./primitives"
import type { Workspace } from "../../../shared/types"
import { toast } from "sonner"

type CreationStep = 'choice' | 'create' | 'open' | 'remote'

interface WorkspaceCreationScreenProps {
  /** Callback when a workspace is created successfully */
  onWorkspaceCreated: (workspace: Workspace) => void
  /** Callback when the screen is dismissed */
  onClose: () => void
  className?: string
  /** When set, skip choice step and open ConnectRemote in reconnect mode */
  reconnectWorkspace?: Workspace
  /** Reconnect an existing remote workspace and resolve only on real success. */
  onReconnectWorkspace?: (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => Promise<void>
}

/**
 * WorkspaceCreationScreen - Full-screen overlay for creating workspaces
 *
 * Obsidian-style flow:
 * 1. Choice: Create new workspace OR Open existing folder
 * 2a. Create: Enter name + choose location (default or custom)
 * 2b. Open: Browse folder OR create new folder at location
 */
export function WorkspaceCreationScreen({
  onWorkspaceCreated,
  onClose,
  className,
  reconnectWorkspace,
  onReconnectWorkspace,
}: WorkspaceCreationScreenProps) {
  const { t } = useTranslation()
  // Start at 'remote' step directly when reconnecting
  const [step, setStep] = useState<CreationStep>(reconnectWorkspace ? 'remote' : 'choice')
  const [isCreating, setIsCreating] = useState(false)

  // Wrap onClose to prevent closing during creation
  // FullscreenOverlayBase handles ESC key, this wrapper prevents closing when busy
  const handleClose = useCallback(() => {
    if (!isCreating) {
      onClose()
    }
  }, [isCreating, onClose])

  const handleCreateWorkspace = useCallback(async (folderPath: string, name: string, remoteServer?: { url: string; token: string; remoteWorkspaceId: string }) => {
    setIsCreating(true)
    try {
      const workspace = await window.electronAPI.createWorkspace(folderPath, name, remoteServer)
      onWorkspaceCreated(workspace)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(t('toast.failedToCreateWorkspace'), {
        description: message,
      })
    } finally {
      setIsCreating(false)
    }
  }, [onWorkspaceCreated])

  const handleReconnectWorkspace = useCallback(async (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => {
    if (!onReconnectWorkspace) {
      throw new Error('Reconnect handler not configured')
    }

    setIsCreating(true)
    try {
      await onReconnectWorkspace(workspaceId, remoteServer)
    } finally {
      setIsCreating(false)
    }
  }, [onReconnectWorkspace])

  const renderStep = () => {
    switch (step) {
      case 'choice':
        return (
          <AddWorkspaceStep_Choice
            onCreateNew={() => setStep('create')}
            onOpenFolder={() => setStep('open')}
            onConnectRemote={() => setStep('remote')}
          />
        )

      case 'create':
        return (
          <AddWorkspaceStep_CreateNew
            onBack={() => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
          />
        )

      case 'open':
        return (
          <AddWorkspaceStep_OpenFolder
            onBack={() => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
          />
        )

      case 'remote':
        return (
          <AddWorkspaceStep_ConnectRemote
            onBack={reconnectWorkspace ? onClose : () => setStep('choice')}
            onCreate={handleCreateWorkspace}
            isCreating={isCreating}
            initialUrl={reconnectWorkspace?.remoteServer?.url}
            initialToken={reconnectWorkspace?.remoteServer?.token}
            reconnectWorkspace={reconnectWorkspace?.remoteServer ? {
              id: reconnectWorkspace.id,
              name: reconnectWorkspace.name,
              remoteWorkspaceId: reconnectWorkspace.remoteServer.remoteWorkspaceId,
            } : undefined}
            onUpdate={handleReconnectWorkspace}
          />
        )

      default:
        return null
    }
  }

  // FullscreenOverlayBase handles portal, traffic lights, and ESC key
  return (
    <FullscreenOverlayBase
      isOpen={true}
      onClose={handleClose}
      className={cn("z-splash flex flex-col bg-background", className)}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={overlayTransitionIn}
        className="flex min-h-0 flex-1 flex-col"
      >
        <AddWorkspacePage
          className="min-h-0 flex-1"
          action={
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                handleClose()
              }}
              disabled={isCreating}
              aria-label={t('common.close')}
            >
              <X />
            </Button>
          }
        >
          {renderStep()}
        </AddWorkspacePage>
      </motion.div>
    </FullscreenOverlayBase>
  )
}
