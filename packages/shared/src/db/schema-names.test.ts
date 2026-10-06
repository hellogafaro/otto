import { Glob } from 'bun'
import { expect, test } from 'bun:test'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { getTableName, is, Table } from 'drizzle-orm'
import { join } from 'node:path'

/** The naming rule of docs/schema.md: tables plural snake_case (`library` is the one singular), every column snake_case. */
test('every table is plural snake_case and every column snake_case', async () => {
  const root = join(import.meta.dir, '..')
  const bad: string[] = []
  let tables = 0
  for await (const file of new Glob('**/schema.ts').scan({ cwd: root })) {
    for (const value of Object.values(await import(join(root, file)))) {
      if (!is(value, Table)) continue
      tables++
      const name = getTableName(value)
      if (!/^[a-z][a-z0-9_]*$/.test(name) || (!name.endsWith('s') && name !== 'library')) bad.push(`${file}: table ${name}`)
      for (const column of getTableConfig(value as SQLiteTable).columns) {
        if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(column.name)) bad.push(`${file}: ${name}.${column.name}`)
      }
    }
  }
  expect(tables).toBeGreaterThan(15)
  expect(bad).toEqual([])
})
