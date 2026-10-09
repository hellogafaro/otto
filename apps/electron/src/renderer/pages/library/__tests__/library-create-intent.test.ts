import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../library-page.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('library-page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler: ts.VariableDeclaration | undefined
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'prefillCreate') handler = node
  ts.forEachChild(node, visit)
}
visit(file)
if (!handler?.initializer) throw new Error('Library creation intent handler is missing')
const compiled = ts.transpileModule(`const ${handler.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

it('Library document and folder creation only prefill editable intent with the selected parent', () => {
  const drafts: string[] = []
  const keys: string[] = []
  const translate = (key: string, values: { defaultValue: string; context: string }) => {
    keys.push(key)
    return values.defaultValue.replace('{{context}}', values.context)
  }
  const run = new Function('dispatchPrefillInputEvent', 't', 'view', `${compiled}; return prefillCreate`)
  run((text: string) => drafts.push(text), translate, {})('document')
  run((text: string) => drafts.push(text), translate, { folder: 'existing-folder' })('folder')
  expect(keys).toEqual(['library.createDocumentPrompt', 'library.createFolderPrompt'])
  expect(drafts).toEqual(['Help me create a Library document. Details: ', 'Help me create a Library folder in library:existing-folder. Details: '])
  expect(handler!.getText(file)).not.toMatch(/(?:createLibraryItem|submit|sendMessage|setCreating)/)
  expect(source).not.toContain('RenameDialog')
  expect(source).not.toContain('submitCreate')
  expect(source).not.toContain('setCreating')
  expect(source).toContain('onNewDocument={() => prefillCreate(\'document\')}')
  expect(source).toContain('onNewFolder={() => prefillCreate(\'folder\')}')
  expect(source).toContain('onUpload={() => fileInput.current?.click()}')
  expect(source).toContain('{dialogs.dialogs}')
})
