// drizzle-kit config. `bun run db:generate` diffs server/schema.ts against drizzle/ and writes a new migration.
// Migrations are applied at runtime by server/migrate.ts, so no DB credentials are needed here.
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/schema.ts',
  out: './drizzle',
})
