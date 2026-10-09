import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../project-page.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('project-page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

it('keeps task creation as scoped composer intent without an unreachable task modal', () => {
  const imports: string[] = []
  const variables: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) imports.push(node.moduleSpecifier.getText(file))
    if (ts.isVariableDeclaration(node)) variables.push(node.name.getText(file))
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(imports.some((entry) => entry.includes('task-form-dialog'))).toBe(false)
  expect(variables.some((entry) => entry.includes('newTask'))).toBe(false)
  expect(source).toContain("dispatchPrefillInputEvent(t('tasks.createPrompt'")
  expect(source).toContain('context: ` in project:${project.id}`')
  expect(source).not.toContain('TaskFormDialog')
})

it('keeps membership and resource operations in the existing scoped domain callbacks', () => {
  expect(source).toContain('projectsApi.addProjectMember(project.id, actor)')
  expect(source).toContain('projectsApi.removeProjectMember(project.id, actor)')
  expect(source).toContain('saveResources(next)')
  expect(source).toContain('expectedUpdatedAt: version.current')
  expect(source).toContain('task.projectId === project.id')
  expect(source).not.toContain('repositoryUrl')
})
