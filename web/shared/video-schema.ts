// Schema for the video index. Written by scripts/videos/*.ts on the host; the
// web server only ever opens it read-only. Keep both sides importing this.
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
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_client_date ON videos (client_id, shot_date);
CREATE INDEX IF NOT EXISTS videos_client_exercise ON videos (client_id, exercise);
`
