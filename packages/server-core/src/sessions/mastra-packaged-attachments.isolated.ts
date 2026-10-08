import { expect, it } from 'bun:test'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

it('isolated desktop server/schema-worker layout initializes schema and parses PDF without ancestor node_modules', async () => {
  const root = resolve(import.meta.dir, '../../../..')
  const dir = await mkdtemp(join(tmpdir(), 'otto-packaged-attachments-'))
  try {
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await mkdir(join(dir, 'config'))
    for (const name of ['drizzle-kit', 'drizzle-orm', 'pdfjs-dist', '@napi-rs']) await cp(join(root, 'node_modules', name), join(dir, 'node_modules', name), { recursive: true })
    const source = join(dir, 'entry.ts')
    const data = 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAxMDAgMTAwXSAvUmVzb3VyY2VzIDw8ID4+ID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMjAzCiUlRU9G'
    await writeFile(source, `import { initSchema } from ${JSON.stringify(join(root, 'packages/shared/src/db/init-schema.ts'))}; await initSchema(); if(Object.keys(Array.prototype).includes('random'))throw new Error('Prototype pollution'); const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'); const task=getDocument({data:new Uint8Array(Buffer.from('${data}','base64'))}); try {if((await task.promise).numPages!==1)throw new Error('PDF failed'); console.log('PACKAGED_SCHEMA_PDF_PASS')} finally {await task.destroy()}`)
    for (const [entry, output] of [[source, 'server.js'], [join(root, 'packages/shared/src/db/push-worker.ts'), 'schema-worker.js']]) {
      const built = Bun.spawnSync([process.execPath, 'run', 'esbuild', entry!, '--bundle', '--platform=node', '--format=esm', '--target=esnext', `--outfile=${join(dir, output!)}`, '--external:bun', '--external:bun:*', '--external:drizzle-orm', '--external:drizzle-kit', '--external:pdfjs-dist', '--log-level=error'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      expect(built.exitCode).toBe(0)
    }
    const env = { ...process.env, OTTO_CONFIG_DIR: join(dir, 'config'), NODE_PATH: '' }
    const proc = Bun.spawnSync([process.execPath, 'run', join(dir, 'server.js')], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' })
    expect(proc.exitCode).toBe(0)
    expect(proc.stdout.toString()).toContain('PACKAGED_SCHEMA_PDF_PASS')
    const config = await Bun.file(join(root, 'apps/electron/electron-builder.yml')).text()
    expect(config.match(/from: ..\/..\/node_modules\/pdfjs-dist/g)).toHaveLength(3)
    expect(config.match(/from: ..\/..\/node_modules\/@napi-rs/g)).toHaveLength(3)
    expect(dirname(dir)).not.toContain(root)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)
