/**
 * Runs the test suite with a disposable Postgres for the DB-backed tests.
 *
 * The auth/invite/api suites refuse to run without `TEST_DATABASE_URL`, so this
 * keeps a throwaway container (`coach-test-db`, host port 127.0.0.1:55432)
 * running and points the suite at it. Pass `--no-db` to skip the container work
 * and just run `bun test`.
 *
 *   bun run test              # start/lookup the disposable db, then test
 *   bun run test --no-db      # plain bun test
 */
import { execFileSync, spawnSync } from 'node:child_process'

const NAME = 'coach-test-db'
const PORT = '55432'
const IMAGE = 'postgres:17'
const URL = `postgres://coach:coach_test_pw@127.0.0.1:${PORT}/coach_test`

const args = process.argv.slice(2)
const useDb = !args.includes('--no-db')
const testArgs = args.filter((a) => a !== '--no-db')

function docker(argv: string[], opts: { quiet?: boolean } = {}): string {
  return execFileSync('docker', argv, {
    encoding: 'utf8',
    stdio: opts.quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
  }).trim()
}

function exists(): boolean {
  try {
    return docker(['ps', '-a', '--filter', `name=^${NAME}$`, '--format', '{{.Names}}'], { quiet: true }) === NAME
  } catch {
    return false
  }
}

function running(): boolean {
  try {
    return docker(['inspect', '-f', '{{.State.Running}}', NAME], { quiet: true }) === 'true'
  } catch {
    return false
  }
}

function waitReady(): void {
  for (let i = 0; i < 60; i++) {
    const probe = spawnSync('docker', ['exec', NAME, 'pg_isready', '-U', 'coach', '-d', 'coach_test'], {
      stdio: 'ignore',
    })
    if (probe.status === 0) return
    Bun.sleepSync(500)
  }
  throw new Error(`${NAME} did not become ready`)
}

let databaseUrl = process.env.TEST_DATABASE_URL

if (useDb && !databaseUrl) {
  if (!exists()) {
    console.log(`starting disposable test database (${IMAGE}) on 127.0.0.1:${PORT}`)
    docker([
      'run', '-d', '--name', NAME,
      '-e', 'POSTGRES_USER=coach',
      '-e', 'POSTGRES_PASSWORD=coach_test_pw',
      '-e', 'POSTGRES_DB=coach_test',
      '-p', `127.0.0.1:${PORT}:5432`,
      IMAGE,
    ])
  } else if (!running()) {
    console.log(`starting ${NAME}`)
    docker(['start', NAME])
  }
  waitReady()
  databaseUrl = URL
}

const env = { ...process.env }
if (databaseUrl) env.TEST_DATABASE_URL = databaseUrl

const result = spawnSync('bun', ['test', ...testArgs], { stdio: 'inherit', env })
process.exit(result.status ?? 1)
