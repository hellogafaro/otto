import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../tasks-page.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('tasks-page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler: ts.VariableDeclaration | undefined
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'newTask') handler = node
  ts.forEachChild(node, visit)
}
visit(file)
if (!handler?.initializer) throw new Error('TasksPage newTask handler is missing')
const compiled = ts.transpileModule(`const ${handler.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

it('New task always prefills editable task intent without a project prerequisite or modal', () => {
  const drafts: string[] = []
  const translate = (key: string, values: { defaultValue: string; context: string }) => {
    expect(key).toBe('tasks.createPrompt')
    return values.defaultValue.replace('{{context}}', values.context)
  }
  const run = new Function('dispatchPrefillInputEvent', 't', 'filters', `${compiled}; return newTask`)
  run((text: string) => drafts.push(text), translate, {})()
  expect(drafts).toEqual(['Help me create a task. Details: '])
  run((text: string) => drafts.push(text), translate, { project: 'explicit-project' })()
  expect(drafts.at(-1)).toBe('Help me create a task in project:explicit-project. Details: ')
  expect(source).not.toContain('hasProject')
  expect(source).not.toContain('TaskFormDialog')
  expect(source).not.toContain('ProjectFormDialog')
  expect(source).not.toContain('sectionEmpty.newProject')
  expect(source).toContain("<Button onClick={() => newTask()}>{t('sectionEmpty.newTask')}</Button>")
  expect((handler!.initializer as ts.ArrowFunction).parameters).toHaveLength(0)
  expect(source).not.toContain('onCreateTask=')
  expect(handler!.getText(file)).not.toMatch(/(?:submit|send|createTask|setCreating)/i)
})
