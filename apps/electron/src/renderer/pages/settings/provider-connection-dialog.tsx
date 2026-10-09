import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { ChevronRight } from 'lucide-react'
import { useRegisterModal } from '@/context/modal-context'
import { KeyConnectionStep } from '@/components/onboarding/key-connection-step'
import { connectionKindName, keySetup, uniqueSlug, type KeyFormValues } from '@/components/onboarding/connection-kinds'
import { SettingsCard, SettingsRow } from '@/components/settings'
import { ProviderLogo } from '@/components/icons/provider-logo'
import { providerIcons } from '@/lib/provider-icons'
import { bindAddScope, PROVIDER_FAMILIES, type ProviderFamily } from './provider-connection-form'

export function ProviderConnectionDialog({ scope, workspaceId, existingSlugs, onClose, onSaved }: {
  scope: 'user' | 'workspace' | null
  workspaceId?: string
  existingSlugs: ReadonlySet<string>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  useRegisterModal(scope !== null, onClose)
  return (
    <Dialog open={scope !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t('connections.new')}</DialogTitle></DialogHeader>
        {scope && <ProviderConnectionForm key={`${scope}:${workspaceId}`} scope={scope} existingSlugs={existingSlugs} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function ProviderConnectionForm({ scope, existingSlugs, onClose, onSaved }: {
  scope: 'user' | 'workspace'
  existingSlugs: ReadonlySet<string>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<ProviderFamily | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const connect = async (values: KeyFormValues): Promise<string | null> => {
    if (!kind) return t('connections.testFailed')
    const { test, setup } = keySetup(kind, bindAddScope(values, scope), { slug: uniqueSlug(kind, existingSlugs), title: connectionKindName(kind) })
    try {
      if (!(await window.electronAPI.testLlmConnectionSetup(test)).success) return t('connections.testFailed')
      if (!mounted.current) return t('connections.saveFailed')
      if (!(await window.electronAPI.setupLlmConnection(setup)).success) return t('connections.saveFailed')
      if (!mounted.current) return null
      onSaved()
      onClose()
      return null
    } catch {
      return t('connections.saveFailed')
    }
  }
  return kind
    ? <KeyConnectionStep key={kind} kind={kind} canShare={false} onSubmit={connect} onBack={() => setKind(null)} />
    : <SettingsCard>{PROVIDER_FAMILIES.map((family) => (
      <SettingsRow key={family} icon={<ProviderLogo src={providerIcons[family]} />} label={connectionKindName(family)} description={t('connections.form.apiKey')} onClick={() => setKind(family)}>
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </SettingsRow>
    ))}</SettingsCard>
}
