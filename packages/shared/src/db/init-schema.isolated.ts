import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths'
import { openDb } from './index'
import { initSchema } from './init-schema'

it('boot schema initialization is serialized in an isolated worker, preserves rows and refuses data loss', async () => {
  const path = join(CONFIG_DIR, 'boot-schema-fixture.db')
  expect(Object.keys(Array.prototype)).not.toContain('random')
  const statements = await initSchema(path)
  expect(statements.length).toBeGreaterThan(0)
  expect(Object.keys(Array.prototype)).not.toContain('random')
  const db = openDb(path)
  try {
    db.$client.exec("INSERT INTO secrets VALUES ('fixture', 'Fixture secret', 'opaque-disposable-value'); CREATE TABLE unknown_live_table (id text); INSERT INTO unknown_live_table VALUES ('retain')")
    await expect(initSchema(path)).rejects.toThrow('Refusing a push that loses data')
    expect(db.$client.query('SELECT id FROM secrets').all()).toEqual([{ id: 'fixture' }])
    expect(db.$client.query('SELECT id FROM unknown_live_table').all()).toEqual([{ id: 'retain' }])
    db.$client.exec('DROP TABLE unknown_live_table')
    expect(await initSchema(path)).toEqual([])
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({ data: new Uint8Array(Buffer.from('JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAxMDAgMTAwXSAvUmVzb3VyY2VzIDw8ID4+ID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMjAzCiUlRU9G', 'base64')) })
    try { expect((await task.promise).numPages).toBe(1) } finally { await task.destroy() }
    await expect(initSchema(join(CONFIG_DIR, 'missing-directory', 'otto.db'))).rejects.toThrow()
  } finally { db.$client.close() }
})
