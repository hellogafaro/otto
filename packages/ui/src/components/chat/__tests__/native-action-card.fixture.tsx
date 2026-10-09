import * as React from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { NativeActionCard, type NativeActionCardData, type NativeActionArtifact } from '../native-action-card'
import '../../../../../../apps/electron/src/renderer/index.css'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } })

const initial: NativeActionCardData = {
  id: 'approval-fixture', kind: 'approval', status: 'pending',
  title: 'Update the project brief',
  summary: 'Replace **Goals** in `Launch brief` with the reviewed plan. The original document stays in Library.',
  details: '## Change preview\n\n- Keep the existing document ID.\n- Replace the Goals section with the reviewed plan.\n- Leave all other sections unchanged.',
}
const proof = {
  calls: [] as unknown[], opened: [] as NativeActionArtifact[],
  reject: undefined as undefined | (() => void), resolve: undefined as undefined | (() => void),
  update: (_data: Partial<NativeActionCardData>) => {},
  setCanResolve: (_canResolve: boolean) => {},
  reset: (_data?: Partial<NativeActionCardData>, _canResolve?: boolean) => '',
  renderedId: '',
  renderedStatus: '',
}
Object.assign(window, { proof })

function Fixture() {
  const [data, setData] = React.useState(initial)
  const [canResolve, setCanResolve] = React.useState(true)
  proof.update = (update) => setData((current) => ({ ...current, ...update }))
  proof.setCanResolve = setCanResolve
  proof.reset = (update = {}, allowed = true) => {
    proof.calls = []
    proof.opened = []
    setCanResolve(allowed)
    const id = crypto.randomUUID()
    setData({ ...initial, ...update, id })
    return id
  }
  React.useLayoutEffect(() => { proof.renderedId = data.id; proof.renderedStatus = data.status }, [data.id, data.status])
  const submit = (answer: unknown) => {
    proof.calls.push(answer)
    return new Promise<void>((resolve, reject) => {
      proof.resolve = resolve
      proof.reject = () => reject(new Error('RAW_PRIVATE_ERROR_BODY fixture-secret'))
    })
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
      <p>Controlled component fixture · no server, user action, credential, or real document</p>
      <NativeActionCard data={data} canResolve={canResolve} onApprove={() => submit('approved')} onDeny={() => submit('denied')} onAnswer={submit} onOpenArtifact={(artifact) => proof.opened.push(artifact)} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
