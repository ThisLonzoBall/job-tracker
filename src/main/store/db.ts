import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

export interface Migration {
  /** Sort key and identity. Never rename a migration once it has shipped. */
  name: string
  sql: string
}

let savepointSeq = 0

/**
 * Runs `fn` atomically: everything it writes lands together or not at all.
 *
 * Built on SAVEPOINT rather than BEGIN so that calls nest. The sync engine
 * must commit Gmail's history cursor in the same transaction as the rows it
 * describes, while also calling helpers like `appendEvent` that open their
 * own. A second BEGIN would throw; a nested SAVEPOINT composes, and only the
 * outermost RELEASE actually commits.
 */
export function transaction<T>(db: DB, fn: () => T): T {
  const name = `sp_${++savepointSeq}`
  db.exec(`SAVEPOINT ${name}`)
  try {
    const result = fn()
    db.exec(`RELEASE ${name}`)
    return result
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`)
    db.exec(`RELEASE ${name}`)
    throw error
  }
}

/**
 * Applies any migrations the database has not seen yet, in name order.
 *
 * Each migration runs inside a transaction together with its bookkeeping
 * insert, so one that throws leaves no partial schema and no record of success.
 *
 * Migrations are passed in rather than read from disk: the main process is
 * bundled, and the bundler has no reason to copy loose .sql files alongside it.
 */
export function migrate(db: DB, migrations: readonly Migration[]): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)

  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]).map((r) => r.name)
  )

  const pending = [...migrations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((m) => !applied.has(m.name))

  const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')

  for (const migration of pending) {
    transaction(db, () => {
      db.exec(migration.sql)
      record.run(migration.name, Date.now())
    })
  }

  return pending.map((m) => m.name)
}

/**
 * Opens the database and brings it up to date.
 *
 * Uses Node's built-in SQLite rather than a native addon, so the same code runs
 * under plain Node for tests and under Electron for the app with no rebuild step.
 *
 * WAL keeps the UI's reads from blocking on a sync that is mid-write, which
 * matters because both live in the same process.
 */
export function openDatabase(dbPath: string, migrations: readonly Migration[]): DB {
  const db = new DatabaseSync(dbPath)

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // Durable enough for a local app, and much faster under WAL.
  db.exec('PRAGMA synchronous = NORMAL')

  migrate(db, migrations)
  return db
}

export function getSyncState(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSyncState(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}
