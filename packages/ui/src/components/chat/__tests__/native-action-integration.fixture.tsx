import * as React from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Message, NativeActionData } from '@otto/core'
import { TurnCard } from '../turn-card'
import { groupMessagesByTurn, type AssistantTurn } from '../turn-utils'
import type { NativeActionArtifact } from '../native-action-card'
import './native-action-integration.fixture.css'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } })

const initial: NativeActionData = {
  id: 'tool-call-1', kind: 'approval', status: 'pending', title: 'Update the project brief',
  summary: 'Replace **Goals** in the reviewed brief. The existing Library item stays unchanged until approved.',
  details: '## Change preview\n\nKeep the same document ID. Replace only the Goals section.',
  eligibleActors: ['user:viewer-1', 'user:viewer-2'], runId: 'run-1', payloadHash: 'payload-1',
}
const proof = {
  calls: [] as unknown[], opened: [] as NativeActionArtifact[],
  update: (_data: Partial<NativeActionData>, _enabled = true) => {},
  reject: () => {},
  revision: 0,
}
Object.assign(window, { proof })

function Fixture() {
  const [data, setData] = React.useState(initial)
  const [enabled, setEnabled] = React.useState(true)
  proof.update = (update, live = true) => { setData(current => ({ ...current, ...update })); setEnabled(live) }
  React.useLayoutEffect(() => { proof.revision += 1 }, [data, enabled])
  const messages: Message[] = [
    { id: 'before', role: 'tool', content: '', timestamp: 1, toolName: 'Read', toolUseId: 'before', toolStatus: 'completed', toolIntent: 'Read the existing brief' },
    { id: 'action-row', role: 'tool', content: 'RAW_PRIVATE_RESULT', toolResult: 'RAW_PRIVATE_RESULT', toolInput: { private: 'RAW_PRIVATE_INPUT' }, toolName: 'library_update', toolUseId: data.id, toolStatus: 'pending', timestamp: 2, nativeAction: data },
    { id: 'after', role: 'tool', content: '', timestamp: 3, toolName: 'Read', toolUseId: 'after', toolStatus: 'completed', toolIntent: 'Later activity' },
  ]
  const turn = groupMessagesByTurn(messages, { isSessionProcessing: enabled })[0] as AssistantTurn
  const respond = async (toolUseId: string, allowed: boolean) => {
    proof.calls.push({ sessionId: 'fixture-chat', toolUseId, allowed, alwaysAllow: false })
    return new Promise<void>((_resolve, reject) => { proof.reject = () => reject(new Error('RAW_PRIVATE_BACKEND_ERROR')) })
  }
  const answer = async (toolUseId: string, answer: string | string[]) => {
    proof.calls.push({ sessionId: 'fixture-chat', toolUseId, answer })
    return new Promise<void>((_resolve, reject) => { proof.reject = () => reject(new Error('RAW_PRIVATE_BACKEND_ERROR')) })
  }
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-5">
      <p>Isolated canonical renderer fixture · no server or real user data</p>
      <div className="grid gap-6 md:grid-cols-2">
        {['user:viewer-1', 'user:viewer-2'].map(actor => (
          <section key={actor} data-viewer={actor} className="min-w-0">
            <h2 className="mb-3 font-medium">{actor}</h2>
            <TurnCard {...turn} sessionId="fixture-chat" nativeActionActor={actor} nativeActionRunId="run-1" nativeActionsEnabled={enabled} onRespondToNativeApproval={respond} onRespondToNativeQuestion={answer} onOpenNativeArtifact={artifact => proof.opened.push(artifact)} />
          </section>
        ))}
      </div>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
