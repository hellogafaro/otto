import { openDb } from '../packages/shared/src/db/index.ts'
import { pushSchema } from '../packages/shared/src/db/push.ts'
import { rebuildMessagesSearch } from '../packages/shared/src/sessions/messages.ts'

// bun run db:push [--force]
const db = openDb()
const statements = await pushSchema(db, { force: process.argv.includes('--force') })
console.log(statements.length ? statements.join('\n') : 'Database is up to date')
// A push that rebuilds `messages` renumbers its rowids, the key of the chat search index: rebuild that too
if (statements.some((statement) => /\bmessages\b/.test(statement))) {
  console.log(`Rebuilt the chat search index (${rebuildMessagesSearch(db)} messages)`)
}
