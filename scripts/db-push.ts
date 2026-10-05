import { openDb } from '../packages/shared/src/db/index.ts'
import { pushSchema } from '../packages/shared/src/db/push.ts'

// bun run db:push [--force]
const statements = await pushSchema(openDb(), { force: process.argv.includes('--force') })
console.log(statements.length ? statements.join('\n') : 'Database is up to date')
