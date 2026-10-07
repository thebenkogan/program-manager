// Postgres pool shared by Better Auth and the invites table. Program content is never stored here.
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

export const pool = new pg.Pool({ connectionString: url })
