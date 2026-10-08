import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { posix } from 'node:path'
import { getComputerRuns } from '../../../shared/src/computer/lifecycle.ts'
import { ChatComputer } from '../../../shared/src/computer/chat-computer.ts'
import { parseBrowserCommand, runBrowserCommand } from '../../../shared/src/browser/tool.ts'
import type { AgentBrowser } from '../../../shared/src/browser/agent-browser.ts'
import type { PermissionMode } from '../../../shared/src/agent/mode-types.ts'

type Scope = {
  workspaceId: string
  agentId: string
  chatId: string
  mode: PermissionMode
  getMode: () => PermissionMode
  signal: AbortSignal
  assertAccess: () => void
}

export function createMastraComputerTools(input: Scope & { computer: ChatComputer }) {
  const computer = input.computer
  if (!(computer instanceof ChatComputer) || Object.entries(computer.scope).some(([key, value]) => value !== input[key as 'workspaceId' | 'agentId' | 'chatId'])) {
    throw new Error('Computer tools require this exact chat, workspace and agent allocation; shared or host computers are not admitted.')
  }
  const assertAccess = (write: boolean, signal: AbortSignal) => {
    signal.throwIfAborted()
    input.assertAccess()
    signal.throwIfAborted()
    if (input.getMode() !== input.mode) throw new Error('The permission mode changed. Start a new turn under the current mode.')
    if (write && input.mode === 'safe') throw new Error('Computer writes and commands are unavailable in Explore mode.')
  }
  const execute = async (argv: string[], write: boolean, contextSignal?: AbortSignal, stdin?: string, maxOutputBytes = 65536) => {
    const signal = AbortSignal.any([input.signal, ...(contextSignal ? [contextSignal] : []), AbortSignal.timeout(30000)])
    assertAccess(write, signal)
    const release = await getComputerRuns(computer.id).acquire({ signal })
    try {
      assertAccess(write, signal)
      await computer.ensureRunning()
      assertAccess(write, signal)
      const directory = computer.exec(['mkdir', '-p', computer.cwd], { cwd: '/home/agent', signal })
      await Promise.all([new Response(directory.stdout).text(), new Response(directory.stderr).text()])
      if (await directory.exited !== 0) throw new Error('The isolated computer working directory could not be prepared.')
      assertAccess(write, signal)
      const spawned = computer.exec(argv, { signal, stdin: stdin !== undefined })
      if (stdin !== undefined) {
        await spawned.stdin?.write(stdin)
        await spawned.stdin?.end()
      }
      const drain = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader()
        let size = 0
        const chunks: Uint8Array[] = []
        try {
          for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            size += chunk.value.byteLength
            if (size > maxOutputBytes) {
              spawned.kill()
              await spawned.exited
              throw new Error('Computer output exceeded its byte limit; the allocation was terminated. The action may have run.')
            }
            chunks.push(chunk.value)
          }
        } finally {
          reader.releaseLock()
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      }
      const [stdout, stderr, code] = await Promise.all([drain(spawned.stdout), drain(spawned.stderr), spawned.exited])
      assertAccess(write, signal)
      return { stdout, stderr, code }
    } catch (error) {
      await computer.terminate()
      throw error
    } finally {
      release()
    }
  }
  const path = z.string().min(1).max(2048).refine((value) => !value.includes('\0'), 'Invalid path')
  return {
    read: createTool({
      id: 'read', description: 'Read bounded text from this task’s isolated computer. Paths are container paths, never server or another chat paths. Binary attachments use Library tools.',
      inputSchema: z.object({ path }).strict(),
      execute: (args, context) => execute(['head', '-c', '65537', '--', args.path], false, context?.abortSignal),
    }),
    ls: createTool({
      id: 'ls', description: 'List entries in this task’s isolated computer. No host folders are mounted.',
      inputSchema: z.object({ path }).strict(),
      execute: (args, context) => execute(['ls', '-la', '--', args.path], false, context?.abortSignal),
    }),
    write: createTool({
      id: 'write', description: 'Write bounded UTF-8 text in this task’s isolated computer, not Library or server files. Creates parent directories. Requires write authorization.',
      inputSchema: z.object({ path, content: z.string().max(65536) }).strict(),
      execute: (args, context) => execute(['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', args.path], true, context?.abortSignal, args.content),
    }),
    edit: createTool({
      id: 'edit', description: 'Replace exactly one matching text span in a bounded UTF-8 file in this task’s computer. Refuses ambiguous or stale text. No host paths.',
      inputSchema: z.object({ path, oldText: z.string().min(1).max(65536), newText: z.string().max(65536) }).strict(),
      execute: (args, context) => execute(['node', '-e', 'const fs=require("fs");let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>input+=x);process.stdin.on("end",()=>{const a=JSON.parse(input);const bytes=fs.readFileSync(a.path);if(bytes.length>65536)throw Error("File exceeds edit limit");const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);if(text.split(a.oldText).length!==2)throw Error("Expected exactly one matching text span");fs.writeFileSync(a.path,text.replace(a.oldText,()=>a.newText));});'], true, context?.abortSignal, JSON.stringify(args)),
    }),
    bash: createTool({
      id: 'bash', description: 'Run a command in this task’s isolated, offline non-root container. No server/peer files, credentials or network access. Stop terminates this entire task computer; filesystem changes may remain until cleanup.',
      inputSchema: z.object({ command: z.string().min(1).max(16000) }).strict(),
      execute: (args, context) => execute(['bash', '-c', args.command], true, context?.abortSignal),
    }),
    publish_file: createTool({
      id: 'publish_file', description: 'Explicitly publish one generated file from this task’s scratch working folder to the existing workspace Library. Returns its durable Library ID for a chat link. Requires write approval; never publishes folders, symlinks, host paths or other task files. Maximum 4 MiB.',
      inputSchema: z.object({ path, title: z.string().trim().min(1).max(255).optional() }).strict(),
      execute: async (args, context) => {
        const signal = context?.abortSignal ? AbortSignal.any([input.signal, context.abortSignal]) : input.signal
        assertAccess(true, signal)
        if (args.path.includes('\\') || args.path.split('/').includes('..')) throw new Error('Publication requires a path inside this task working folder without traversal.')
        const resolved = posix.resolve(computer.cwd, args.path)
        if (!resolved.startsWith(`${computer.cwd}/`)) throw new Error('Publication requires a file inside this task working folder.')
        const title = args.title ?? posix.basename(resolved)
        if (!title.trim() || /[\/\\\x00-\x1f]/.test(title)) throw new Error('Invalid published filename.')
        const result = await execute(['node', '-e', `
const fs = require('fs'), path = require('path');
const root = process.argv[1], target = process.argv[2];
if (fs.realpathSync(root) !== root) throw Error('Publication root cannot be a symlink');
let current = root;
for (const segment of path.relative(root, target).split(path.sep)) {
  current = path.join(current, segment);
  if (fs.lstatSync(current).isSymbolicLink()) throw Error('Publication cannot follow symlinks');
}
const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
try {
  const actual = fs.realpathSync('/proc/self/fd/' + fd);
  if (!actual.startsWith(root + '/')) throw Error('Publication escaped the task folder');
  const before = fs.fstatSync(fd);
  if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid()) throw Error('Publication requires an owned regular file, not a link or device');
  if (before.size < 1 || before.size > 4 * 1024 * 1024) throw Error('Publication file must be between 1 byte and 4 MiB');
  const bytes = Buffer.alloc(before.size);
  let read = 0;
  while (read < bytes.length) {
    const count = fs.readSync(fd, bytes, read, bytes.length - read, read);
    if (!count) throw Error('Publication file changed while reading');
    read += count;
  }
  const after = fs.fstatSync(fd);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.nlink !== 1) throw Error('Publication file changed while reading');
  process.stdout.write(bytes.toString('base64'));
} finally { fs.closeSync(fd); }
`, computer.cwd, resolved], true, context?.abortSignal, undefined, 6 * 1024 * 1024)
        assertAccess(true, signal)
        if (result.code !== 0) throw new Error('The scratch file could not be published: it must be an unchanged owned regular file inside this task folder, without symlinks, between 1 byte and 4 MiB.')
        const bytes = Buffer.from(result.stdout, 'base64')
        if (bytes.length < 1 || bytes.length > 4 * 1024 * 1024 || bytes.toString('base64') !== result.stdout) throw new Error('Invalid publication bytes.')
        let mime = 'application/octet-stream'
        if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png'
        else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg'
        else if (bytes.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf'
        else if (/\.(md|txt|csv|json)$/i.test(title)) {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          if (text.includes('\0')) throw new Error('The published text file contains binary data.')
          mime = /\.md$/i.test(title) ? 'text/markdown' : /\.csv$/i.test(title) ? 'text/csv' : /\.json$/i.test(title) ? 'application/json' : 'text/plain'
          if (mime === 'application/json') JSON.parse(text)
        }
        if (/\.md$/i.test(title) && mime !== 'text/markdown') throw new Error('A Markdown document must contain UTF-8 text, not binary data.')
        const { createLibraryItem, deleteLibraryItem } = await import('../../../shared/src/library/index.ts')
        assertAccess(true, signal)
        const item = await createLibraryItem({ workspaceId: input.workspaceId, title, mime, bytes, createdBy: `agent:${input.agentId}` })
        try {
          assertAccess(true, signal)
        } catch (error) {
          try { await deleteLibraryItem(input.workspaceId, item.id) } catch { throw new Error('Publication was cancelled or authorization changed, and cleanup of the newly created Library item failed. Do not retry automatically.') }
          throw error
        }
        return { libraryId: item.id, title: item.title, type: item.type, mime: item.mime, size: item.size }
      },
    }),
  }
}

export const MASTRA_COMPUTER_WRITES = new Set(['write', 'edit', 'bash', 'publish_file'])

export function createMastraBrowserTool(input: Scope & { browser: AgentBrowser; assertBrowserIsolation: () => void }) {
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted()
    input.assertAccess()
    input.assertBrowserIsolation()
    if (input.getMode() !== input.mode) throw new Error('The permission mode changed. Start a new turn under the current mode.')
  }
  return createTool({
    id: 'browser_tool',
    description: 'Use only this authorized task’s browser context. One browser command per call. Navigation and page interactions require write authorization; no file URLs, arbitrary server files or host computer access. Cancellation disposes the task browser context; an interrupted action may have run.',
    inputSchema: z.object({ command: z.union([z.string().min(1).max(16000), z.array(z.string().max(16000)).min(1).max(20)]) }).strict(),
    execute: async (args, context) => {
      const signal = AbortSignal.any([input.signal, ...(context?.abortSignal ? [context.abortSignal] : []), AbortSignal.timeout(30000)])
      check(signal)
      const argv = parseBrowserCommand(args.command)
      const name = argv[0]?.toLowerCase()
      const read = ['snapshot', 'find', 'screenshot', 'help', '--help'].includes(name ?? '')
      if (!read && input.mode === 'safe') throw new Error('Browser actions are unavailable in Explore mode.')
      if (['navigate', 'open'].includes(name ?? '') && argv[1]) {
        const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(argv[1]) ? argv[1] : `https://${argv[1]}`)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) browser navigation without URL credentials is admitted.')
      }
      const result = await input.browser.run(input.chatId, { signal, assertAccess: () => check(signal) }, (page) => runBrowserCommand(argv, {
        page: async () => page,
        close: () => input.browser.close(input.chatId),
      }))
      check(signal)
      if (result.output.length > 20000 || (result.screenshot?.length ?? 0) > 4 * 1024 * 1024) throw new Error('Browser output exceeds the native tool limit.')
      return { output: result.output, ...(result.screenshot ? { image: result.screenshot.toString('base64'), mediaType: 'image/png' } : {}) }
    },
    toModelOutput: (value) => {
      const result = value as { output: string; image?: string }
      return { type: 'content', value: [{ type: 'text', text: result.output }, ...(result.image ? [{ type: 'image', data: result.image, mediaType: 'image/png' }] : [])] }
    },
  })
}
