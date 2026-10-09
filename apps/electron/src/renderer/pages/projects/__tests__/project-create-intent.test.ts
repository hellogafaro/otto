import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../projects-page.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('projects-page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler: ts.VariableDeclaration | undefined
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'startProject') handler = node
  ts.forEachChild(node, visit)
}
visit(file)
if (!handler?.initializer) throw new Error('ProjectsPage startProject handler is missing')
const compiled = ts.transpileModule(`const ${handler.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const run = new Function('dispatchPrefillInputEvent', 't', `${compiled}; return startProject`)

it('New project prefills editable intent without generation, project creation, or message submission', () => {
  const drafts: string[] = []
  const translate = (key: string, values: { defaultValue: string }) => {
    expect(key).toBe('projects.createPrompt')
    return values.defaultValue
  }
  run((text: string) => drafts.push(text), translate)()
  expect(drafts).toEqual(['Help me create a project. Ask for any missing name or brief, draft a foundation and let me review it before requesting create approval. Details: '])
  expect(handler!.getText(file)).not.toMatch(/(?:draftProjectFoundation|cancelProjectFoundation|createProject|createTask|addProjectMember|sendMessage|submit|setCreating)/)
})

it('both project entry points use the same localized composer intent without mounting a modal', () => {
  const drafts: string[] = []
  run((text: string) => drafts.push(text), () => 'Localized project intent')()
  expect(drafts).toEqual(['Localized project intent'])
  expect(source).toContain("<CreateButton label={t('projects.newProject')} onClick={startProject} />")
  expect(source).toContain("<Button onClick={startProject}>{t('sectionEmpty.newProject')}</Button>")
  expect(source).not.toContain('ProjectFormDialog')
  expect(source).not.toContain('project-form-dialog')
  expect(source).not.toContain('setCreating')
  expect(source).not.toContain('{dialog}')
  expect(source).not.toContain('window.electronAPI')
})
