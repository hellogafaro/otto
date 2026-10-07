import { sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

/** The query as a LIKE operand: its own `%`, `_` and `\` are text (the pattern's escape is `\`). */
const escapeLike = (query: string) => query.replace(/[\\%_]/g, '\\$&')

/** `column LIKE '%query%'`: how tasks, projects, comments and the library search until FTS is needed (ASCII case-insensitive). */
export const likeContains = (column: SQLiteColumn, query: string): SQL => sql`${column} like ${`%${escapeLike(query)}%`} escape '\\'`

/** For ORDER BY: 0 when `column` starts with the query, 1 when it only contains it, 2 when it does not. */
export const likeRank = (column: SQLiteColumn, query: string): SQL =>
  sql`case when ${column} like ${`${escapeLike(query)}%`} escape '\\' then 0 when ${likeContains(column, query)} then 1 else 2 end`
