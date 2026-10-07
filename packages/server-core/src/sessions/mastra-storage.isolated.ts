import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { openDb } from '@otto/shared/db'
import { pushSchema } from '@otto/shared/db/push'
import { MASTRA_RUNTIME_TABLES } from '@otto/shared/db/mastra-tables'
import { openMastraStorage } from './mastra-storage'
import { createClient } from '@libsql/client'

it('shares one file, preserves both authorities on repeated and forced boot, refuses unknown tables', async () => {
  for (const vendorFirst of [false,true]) {
    const path = join(CONFIG_DIR, vendorFirst ? 'vendor-first.db' : 'app-first.db')
    const app = openDb(path)
    if (!vendorFirst) await pushSchema(app)
    let runtime = await openMastraStorage(path)
    await pushSchema(app)
    expect(await pushSchema(app)).toEqual([])
    const sqlite = app.$client
    sqlite.exec("INSERT INTO users(id,name,email,created_at,updated_at) VALUES('fixtureuser1','Fixture','fixture@example.test',0,0)")
    const memory = await runtime.storage.getStore('memory')
    await memory!.saveThread({ thread: { id:'thread000001',resourceId:'workspace001',title:'Preserved',createdAt:new Date(0),updatedAt:new Date(0) } })
    expect(await pushSchema(app,{force:true})).toEqual([])
    expect(sqlite.query('SELECT id FROM mastra_threads').get()).toEqual({id:'thread000001'})
    expect(sqlite.query('SELECT id FROM users').get()).toEqual({id:'fixtureuser1'})
    const tables = sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mastra_%'").all() as {name:string}[]
    expect(tables.map((table)=>table.name).sort()).toEqual([...MASTRA_RUNTIME_TABLES].sort())
    runtime.close()
    runtime = await openMastraStorage(path)
    expect((await runtime.storage.getStore('memory')) && sqlite.query('SELECT title FROM mastra_threads').get()).toEqual({title:'Preserved'})
    expect(await pushSchema(app)).toEqual([])
    sqlite.exec("CREATE TABLE arbitrary_unknown(id TEXT); INSERT INTO arbitrary_unknown VALUES('keep')")
    await expect(pushSchema(app)).rejects.toThrow('loses data')
    expect(sqlite.query('SELECT id FROM arbitrary_unknown').get()).toEqual({id:'keep'})
    runtime.close(); sqlite.close()
  }
})

it('refuses unapproved vendor tables instead of extending prefix ownership',async()=>{
  const path=join(CONFIG_DIR,'unknown-vendor.db')
  const app=openDb(path)
  await pushSchema(app)
  app.$client.exec("CREATE TABLE mastra_unapproved(id TEXT); INSERT INTO mastra_unapproved VALUES('keep')")
  await expect(pushSchema(app)).rejects.toThrow('loses data')
  await expect(openMastraStorage(path)).rejects.toThrow('ownership set')
  expect(app.$client.query('SELECT id FROM mastra_unapproved').get()).toEqual({id:'keep'})
  app.$client.close()
})

it('uses a single configured handle and rejects transaction overlap without mutating it',async()=>{
  const path=join(CONFIG_DIR,'single-handle.db')
  const runtime=await openMastraStorage(path)
  const client=createClient({url:`file:${path}`,timeout:5000,concurrency:1})
  await client.execute('PRAGMA synchronous=FULL')
  await client.execute('PRAGMA busy_timeout=5000')
  const tx=await client.transaction('read')
  expect(Number((await tx.execute('PRAGMA synchronous')).rows[0]?.synchronous)).toBe(2)
  expect(Number((await tx.execute('PRAGMA busy_timeout')).rows[0]?.timeout)).toBe(5000)
  await expect(client.execute('PRAGMA synchronous')).rejects.toMatchObject({code:'TRANSACTION_ACTIVE'})
  await tx.rollback()
  expect(Number((await client.execute('PRAGMA synchronous')).rows[0]?.synchronous)).toBe(2)
  const memory=await runtime.storage.getStore('memory')
  await Promise.all([1,2].map((index)=>memory!.saveThread({thread:{id:`thread00000${index}`,resourceId:'workspace001',title:'Concurrent',createdAt:new Date(0),updatedAt:new Date(0)}})))
  expect((await memory!.getThreadById({threadId:'thread000001'}))?.title).toBe('Concurrent')
  expect((await memory!.getThreadById({threadId:'thread000002'}))?.title).toBe('Concurrent')
  client.close();runtime.close()
})
