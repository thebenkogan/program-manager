// Drizzle schema for every table the web app owns: Better Auth's four tables and the invites table.
// Better Auth tables keep Better Auth's camelCase field names as both key and column name, so
// drizzleAdapter (auth.ts) maps them without renaming. Changes here need `bun run db:generate`.
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  createdAt: timestamptz('createdAt').defaultNow().notNull(),
  updatedAt: timestamptz('updatedAt').defaultNow().notNull(),
  // Required on user; set server-side from a redeemed invite (see auth.ts additionalFields).
  clientId: text('clientId').notNull(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamptz('expiresAt').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamptz('createdAt').defaultNow().notNull(),
    updatedAt: timestamptz('updatedAt').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_userId_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamptz('accessTokenExpiresAt'),
    refreshTokenExpiresAt: timestamptz('refreshTokenExpiresAt'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamptz('createdAt').defaultNow().notNull(),
    updatedAt: timestamptz('updatedAt').notNull(),
  },
  (t) => [index('account_userId_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expiresAt').notNull(),
    createdAt: timestamptz('createdAt').defaultNow().notNull(),
    updatedAt: timestamptz('updatedAt').defaultNow().notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// Invite links: single-use, 7-day, stored as sha256 hashes only. Snake_case columns predate this schema.
export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    clientId: text('client_id').notNull(),
    email: text('email').notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
  },
  (t) => [index('invites_client_id_idx').on(t.clientId)],
)
