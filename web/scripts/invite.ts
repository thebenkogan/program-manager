// Issues a single-use client invite and prints the link.
// Usage (from web/): bun run invite <clientId> <email>
import { createInvite } from '../server/invites'
import { pool } from '../server/db'

const [clientId, email] = process.argv.slice(2)
if (!clientId || !email) {
  console.error('Usage: bun run invite <clientId> <email>')
  process.exit(2)
}

try {
  const invite = await createInvite(clientId, email)
  console.log(`Invite for ${email} (client ${clientId})`)
  console.log(invite.url)
  console.log(`Expires: ${invite.expiresAt.toISOString()}`)
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
