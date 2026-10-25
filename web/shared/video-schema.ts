// Schema for the video index. Written by scripts/videos/*.ts on the host and by
// the upload worker in the container; the list/read paths only ever open it read-only.
export const VIDEO_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS videos (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  shot_date    TEXT NOT NULL,
  shot_at      TEXT,
  exercise     TEXT NOT NULL,
  weight       REAL,
  sets         INTEGER,
  reps         TEXT,
  set_index    INTEGER,
  notes        TEXT,
  rel_path     TEXT NOT NULL,
  master_path  TEXT,
  poster_path  TEXT,
  duration_s   REAL,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  sha256       TEXT NOT NULL UNIQUE,
  source       TEXT NOT NULL DEFAULT 'manual',
  status       TEXT NOT NULL DEFAULT 'published',
  published_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_client_date ON videos (client_id, shot_date);
CREATE INDEX IF NOT EXISTS videos_client_exercise ON videos (client_id, exercise);

CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  ext         TEXT NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT,
  bytes       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'receiving',
  video_id    TEXT,
  received    TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_client ON uploads (client_id, created_at);
`;

interface SchemaDb {
  exec: (sql: string) => void
  query: (sql: string) => { all: () => unknown[] }
}

/**
 * Idempotent migration for databases created before drafts existed. Safe to call
 * on every open: it only adds missing columns and the uniqueness index.
 */
export function ensureVideoSchema(db: SchemaDb) {
  db.exec(VIDEO_SCHEMA_SQL)
  const columns = db.query('PRAGMA table_info(videos)').all() as { name: string }[]
  const names = new Set(columns.map((c) => c.name))
  if (!names.has('status')) db.exec("ALTER TABLE videos ADD COLUMN status TEXT NOT NULL DEFAULT 'published'")
  if (!names.has('published_at')) db.exec('ALTER TABLE videos ADD COLUMN published_at TEXT')
  // Parallel uploads land out of order, so the upload row tracks received byte ranges.
  const uploadColumns = db.query('PRAGMA table_info(uploads)').all() as { name: string }[]
  if (!uploadColumns.some((c) => c.name === 'received')) {
    db.exec("ALTER TABLE uploads ADD COLUMN received TEXT NOT NULL DEFAULT '[]'")
  }
  db.exec("UPDATE videos SET status = 'published' WHERE status IS NULL OR status = ''")
  // The partial index depends on `status`, so it must be created only after the
  // ALTER above — never inside VIDEO_SCHEMA_SQL, which runs first.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS videos_one_per_day ON videos (client_id, shot_date, exercise) WHERE status = 'published'",
  )
}
