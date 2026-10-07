// Creates the invites table and applies Better Auth's schema migration. Idempotent.
// Usage: bun run migrate   (needs DATABASE_URL)
import { getMigrations } from 'better-auth/db/migration'
import { pool } from './db'
import { authOptions } from './auth'

const INVITES_DDL = `
CREATE TABLE IF NOT EXISTS invites (
  id          text PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,
  client_id   text NOT NULL,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS invites_client_id_idx ON invites (client_id);
`

export async function migrate(): Promise<void> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions as Parameters<typeof getMigrations>[0])
  if (toBeCreated.length || toBeAdded.length) {
    console.log('Better Auth tables to create:', toBeCreated.map((t) => t.table))
    console.log('Better Auth columns to add:', toBeAdded.map((t) => `${t.table}.${Object.keys(t.fields).join(',')}`))
  }
  await runMigrations()
  await pool.query(INVITES_DDL)
  console.log('Migration complete.')
}

if (import.meta.main) {
  try {
    await migrate()
  } finally {
    await pool.end()
  }
}
