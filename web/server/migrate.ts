// Applies the Drizzle migrations in web/drizzle/ (Better Auth tables + invites). Idempotent.
// Usage: bun run migrate   (needs DATABASE_URL)
import path from 'node:path'
import { migrate as runDrizzleMigrations } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './db'

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dir, '../drizzle')

export async function migrate(): Promise<void> {
  await runDrizzleMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER })
  console.log('Migration complete.')
}

if (import.meta.main) {
  try {
    await migrate()
  } finally {
    await pool.end()
  }
}
