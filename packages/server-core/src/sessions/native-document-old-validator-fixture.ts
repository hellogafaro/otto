import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

if (!basename(process.env.OTTO_CONFIG_DIR ?? '').startsWith('otto-test-auth-rpc-')) throw new Error('A disposable document fixture is required.')
const root = process.cwd()
const manager = join(root, 'packages/server-core/src/sessions/session-manager.ts')
Bun.plugin({ name: 'disposable-document-binding-baseline', setup(builder) {
  builder.onLoad({ filter: /session-manager\.ts$/ }, ({ path }) => {
    if (path !== manager) return
    const source = readFileSync(path, 'utf8')
    const start = source.indexOf('      const validateToolInput = async ')
    const end = source.indexOf('      const records = new Map<string, NativeApprovalRecord>()', start)
    if (start < 0 || end < start) throw new Error('The bounded baseline seam changed.')
    const old = `      const validateToolInput = async (tool: import('@mastra/core/tools').Tool<any>, args: unknown) => {
        if (tool.inputSchema && 'parse' in tool.inputSchema && typeof tool.inputSchema.parse === 'function') return tool.inputSchema.parse(args)
        return args
      }
`
    const gate = "throw new Error('This exact action has no current native approval.')"
    const diagnostic = `sessionLog.error('document binding baseline', { toolCallPresent: !!id, grantPresent: !!grant, matchingName: grant?.name === name, matchingInput: grant?.hash === digest(normalized), differingFields: id && records.get(id) ? [...new Set([...Object.keys(records.get(id)!.args), ...Object.keys(normalized as object)])].filter((key) => JSON.stringify(records.get(id)!.args[key]) !== JSON.stringify((normalized as Record<string, unknown>)[key])) : [] }); ${gate}`
    const patched = source.slice(0, start) + old + source.slice(end)
    if (!patched.includes(gate)) throw new Error('The binding seam changed.')
    return { contents: patched.replace(gate, diagnostic), loader: 'ts' }
  })
} })
await import(join(root, 'packages/server/src/index.ts'))
