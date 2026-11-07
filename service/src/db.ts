// The store: one SQLite file, WAL, and a schema that keeps identity, runs,
// cards, events, artifacts and runbooks. Every write in Muster goes through
// here; the CLI, the MCP server and the mods all read the same rows.

import { Database } from "bun:sqlite";
import { databasePath, ensureHome } from "./paths.ts";

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  root        TEXT NOT NULL,
  remote      TEXT,
  marker      TEXT,
  source      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  seen_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_key      TEXT NOT NULL,
  agent        TEXT,
  terminal     TEXT,
  cwd          TEXT NOT NULL,
  branch       TEXT,
  worktree     TEXT,
  machine      TEXT,
  state        TEXT NOT NULL DEFAULT 'working',
  summary      TEXT,
  started_at   TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  ended_at     TEXT
);
CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS runs_open_key ON runs(run_key) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id       TEXT REFERENCES runs(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  severity     TEXT NOT NULL DEFAULT 'info',
  state        TEXT NOT NULL DEFAULT 'open',
  actions_json TEXT NOT NULL DEFAULT '[]',
  refs_json    TEXT NOT NULL DEFAULT '{}',
  answer_json  TEXT,
  dedupe_key   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  answered_at  TEXT
);
CREATE INDEX IF NOT EXISTS cards_project_state ON cards(project_id, state, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cards_dedupe
  ON cards(project_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('open', 'claimed', 'answered');

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL,
  project_id TEXT,
  run_id     TEXT,
  card_id    TEXT,
  payload    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id, at DESC);

CREATE TABLE IF NOT EXISTS artifacts (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id     TEXT REFERENCES runs(id) ON DELETE SET NULL,
  card_id    TEXT REFERENCES cards(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  path       TEXT,
  url        TEXT,
  mime       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_card ON artifacts(card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runbooks (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  source_path TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, slug)
);

CREATE TABLE IF NOT EXISTS runbook_steps (
  project_id TEXT NOT NULL,
  slug       TEXT NOT NULL,
  n          INTEGER NOT NULL,
  title      TEXT NOT NULL,
  command    TEXT,
  state      TEXT NOT NULL DEFAULT 'todo',
  owner_run  TEXT,
  note       TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, slug, n),
  FOREIGN KEY (project_id, slug) REFERENCES runbooks(project_id, slug) ON DELETE CASCADE
);
`;

/** Open the database, creating the folder and the schema when needed. */
export function openDatabase(path = databasePath()): Database {
  ensureHome();
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  if (!version || version.user_version < SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  return db;
}

let shared: Database | null = null;

/** The process-wide database, opened on first use. */
export function getDb(): Database {
  shared ??= openDatabase();
  return shared;
}

/** Close the shared database (tests and one-shot CLI calls do not need it). */
export function closeDb(): void {
  shared?.close();
  shared = null;
}
