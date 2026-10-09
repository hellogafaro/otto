import * as React from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Markdown, MemoizedMarkdown } from '../markdown'
import { NativeActionCard } from '../../chat/native-action-card'
import { PlatformProvider } from '../../../context/platform-context'
import { ShikiThemeProvider } from '../../../context/shiki-theme-context'
import { EntityText } from '../../../../../../apps/electron/src/renderer/components/entities/entity-text'
import { AppShellProvider } from '../../../../../../apps/electron/src/renderer/context/app-shell-context'
import { NavigationContext } from '../../../../../../apps/electron/src/renderer/contexts/navigation-context'
import en from '../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../../apps/electron/src/renderer/index.css'

await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })

const prose = `# Readable project guidance

This is real read-only Markdown with **important text**, *emphasis*, ~~old wording~~, an [external reference](https://example.com/guide), a [local reference](/fixture/guide.md), and inline \`crypto.randomUUID()\` code. No real account or document is involved.

## A clear reading rhythm

Paragraphs and headings use the official Typeset docs profile. Replies retain the existing chat width; only this fixture's selected document prose is measured.

### Steps and alternatives

1. Read the current brief.
2. Preserve the existing ID.
   - Keep the reviewed details.
   - Verify the final result.

- [x] Existing result verified
- [ ] Remaining fixture check

> A short quote can contain **emphasis** and a second paragraph.
>
> The quote remains semantic prose rather than card chrome.

#### Small section

Short supporting explanation.

##### Further context

A lower-level heading remains readable.

###### Reference note

The final heading uses the official profile.

---

| Operation | Target | Preview |
| :--- | :---: | ---: |
| Update | Existing project | Reviewed change |
| Inspect | Existing Library document | No new copy |

## Code and math

\`\`\`ts
const projectId = crypto.randomUUID()
const approved = false
\`\`\`

Inline math $$x^2 + y^2 = z^2$$ and ordinary currency $20 stay distinct.

\`\`\`latex
\\int_0^1 x^2\\,dx = \\frac{1}{3}
\`\`\`

## Interactive embedded table

\`\`\`datatable
{"title":"Existing preview","columns":[{"key":"title","label":"Title","type":"text"},{"key":"count","label":"Count","type":"number"}],"rows":[{"title":"Reviewed","count":2},{"title":"Pending","count":1}]}
\`\`\`

The final paragraph can stream without remounting completed prose, code, math, or embedded controls.`

const wideTable = `| ${Array.from({ length: 7 }, (_, i) => `Column ${i + 1}`).join(' | ')} |
| ${Array.from({ length: 7 }, () => '---').join(' | ')} |
| ${Array.from({ length: 7 }, (_, i) => `Long_unbroken_fixture_reference_${i}`).join(' | ')} |`

const proof = {
  append: () => {},
  setDark: (_dark: boolean) => {},
  links: [] as string[],
  files: [] as string[],
  routes: [] as string[],
}
Object.assign(window, { proof })
const openUrl = (url: string) => proof.links.push(url)
const openFile = (file: string) => proof.files.push(file)
const readFixtureFile = async () => '# Embedded readonly guidance\n\nThis **document prose** uses Typeset while its preview controls remain UI.'
const fixtureShell = { activeWorkspaceId: 'fixture' } as React.ComponentProps<typeof AppShellProvider>['value']
const fixtureNavigation = { navigate: (route: string) => { proof.routes.push(route) } } as unknown as React.ContextType<typeof NavigationContext>

function Fixture() {
  const [content, setContent] = React.useState(prose)
  const [dark, setDark] = React.useState(false)
  proof.setDark = (dark) => { document.documentElement.classList.toggle('dark', dark); setDark(dark) }
  proof.append = () => setContent((current) => current + '\n\nAn appended streaming paragraph keeps completed blocks in place.')
  return (
    <ShikiThemeProvider shikiTheme={dark ? 'github-dark' : 'github-light'}>
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-5">
      <p className="text-sm">Controlled actual-component Typeset fixture. No server, real document, user draft, or credentials.</p>
      <section aria-label="Reply prose">
        <MemoizedMarkdown id="fixture-reply" mode="minimal" onUrlClick={openUrl} onFileClick={openFile}>{content}</MemoizedMarkdown>
      </section>
      <section aria-label="Document prose">
        <Markdown mode="full" className="max-w-[37em]" onUrlClick={openUrl} onFileClick={openFile}>{prose}</Markdown>
      </section>
      <section aria-label="Wide semantic table"><Markdown mode="full">{wideTable}</Markdown></section>
      <section aria-label="Embedded document">
        <PlatformProvider actions={{ onReadFile: readFixtureFile }}>
          <Markdown mode="minimal">{'```markdown-preview\n{"src":"/fixture/embedded.md","title":"Existing document preview"}\n```'}</Markdown>
        </PlatformProvider>
      </section>
      <section aria-label="Terminal output"><Markdown mode="terminal">{'## Raw output\n\n- Keep the terminal mode.\n\n`unchanged`'}</Markdown></section>
      <section aria-label="Safe routing"><Markdown mode="minimal">{'[Unsafe scheme](javascript:alert%281%29) and <a href="data:text/html,fixture">Unsafe raw scheme</a>'}</Markdown></section>
      <section aria-label="Comment prose">
        <AppShellProvider value={fixtureShell}>
          <NavigationContext.Provider value={fixtureNavigation}>
            <EntityText content={'Review **the existing project** project:2d94ad10-b63e-4dcf-80fb-1cc5fbfcd889 before continuing.'} />
          </NavigationContext.Provider>
        </AppShellProvider>
      </section>
      <section aria-label="Request card">
        <NativeActionCard canResolve data={{ id: 'fixture-approval', kind: 'approval', status: 'pending', title: 'Review the existing brief', summary: 'Read the **reviewed preview** before making a decision.' }} />
      </section>
    </main>
    </ShikiThemeProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
