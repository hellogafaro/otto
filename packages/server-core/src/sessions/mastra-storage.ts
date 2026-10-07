import { createClient } from '@libsql/client'
import { HarnessLibSQL, MemoryLibSQL, ThreadStateLibSQL, WorkflowsLibSQL } from '@mastra/libsql'
import { MastraCompositeStore } from '@mastra/core/storage'
import { DB_PATH } from '@otto/shared/db'
import { MASTRA_RUNTIME_TABLES } from '@otto/shared/db/mastra-tables'

export async function openMastraStorage(path = DB_PATH) {
  const client = createClient({ url: `file:${path}`, timeout: 5000, concurrency: 1 })
  try {
    const existing = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mastra_%'")
    if (existing.rows.some((row) => !MASTRA_RUNTIME_TABLES.has(String(row.name)))) throw new Error('Native runtime database tables differ from the pinned ownership set.')
    const domains = {
      memory: new MemoryLibSQL({ client }),
      workflows: new WorkflowsLibSQL({ client }),
      harness: new HarnessLibSQL({ client }),
      threadState: new ThreadStateLibSQL({ client }),
    }
    for (const domain of Object.values(domains)) await domain.init()
    const storage = new MastraCompositeStore({ id: 'otto-runtime', domains, disableInit: true })
    await client.execute('PRAGMA journal_mode=WAL')
    await client.execute('PRAGMA busy_timeout=5000')
    await client.execute('PRAGMA synchronous=FULL')
    const journal = await client.execute('PRAGMA journal_mode')
    const timeout = await client.execute('PRAGMA busy_timeout')
    const synchronous = await client.execute('PRAGMA synchronous')
    if (journal.rows[0]?.journal_mode !== 'wal' || Number(timeout.rows[0]?.timeout) !== 5000 || Number(synchronous.rows[0]?.synchronous) !== 2) {
      throw new Error('Native runtime database durability settings could not be verified.')
    }
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mastra_%'")
    if (tables.rows.length !== MASTRA_RUNTIME_TABLES.size || tables.rows.some((row) => !MASTRA_RUNTIME_TABLES.has(String(row.name)))) {
      throw new Error('Native runtime database tables differ from the pinned ownership set.')
    }
    return { storage, close: () => client.close() }
  } catch (error) {
    client.close()
    throw error
  }
}
