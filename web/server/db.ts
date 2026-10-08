// Postgres pool and Drizzle client shared by Better Auth and the invites table. Program content is never stored here.
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set')
}

export const pool = new pg.Pool({ connectionString: url })
export const db = drizzle(pool, { schema })
