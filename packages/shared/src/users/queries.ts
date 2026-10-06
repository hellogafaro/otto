import { asc, eq } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { domainError } from '../utils/errors.ts'
import { users } from './schema.ts'

/** The name and email the local app gives its one user until the person sets their own. */
export const LOCAL_NAME = 'You'
export const LOCAL_EMAIL = 'local@localhost'

/** Plain reads and writes on `users` that need no Better Auth (so the settings and config code can call them without a secret or a cycle). */

/** The earliest user: who `OTTO_SERVER_TOKEN` and the local app act as, and the owner of the install. */
export const getFirstUser = (db: Db | Tx = initDb()) =>
  db.select().from(users).orderBy(asc(users.createdAt), asc(users.id)).limit(1).get()

/** Name and email of a user, or undefined. */
export const getUser = (userId: string, db: Db | Tx = initDb()) =>
  db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).get()

/** Name and email of a user; either may be left out. An email another user has is a `conflict`. */
export function updateUser(userId: string, input: { name?: string; email?: string }, db: Db | Tx = initDb()): void {
  const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) values.name = input.name.trim() || 'You'
  if (input.email !== undefined) values.email = input.email.trim().toLowerCase()
  try {
    if (!db.update(users).set(values).where(eq(users.id, userId)).returning({ id: users.id }).get()) throw domainError('not_found', 'No such user')
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) throw domainError('conflict', 'Another user has that email')
    throw error
  }
}
