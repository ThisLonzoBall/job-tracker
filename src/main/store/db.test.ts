import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApplication, getApplication, listApplications } from './applications'
import { getSyncState, migrate, openDatabase, setSyncState, transaction, type DB } from './db'
import { appendEvent, stageOf } from './events'
import { MIGRATIONS } from './migrations'

const DAY = 86_400_000
const T0 = Date.parse('2026-03-01T00:00:00Z')

let db: DB

beforeEach(() => {
  db = openDatabase(':memory:', MIGRATIONS)
})

afterEach(() => {
  db.close()
})

const tables = (): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as {
    name: string
  }[]).map((r) => r.name)

describe('migrations', () => {
  it('creates every table', () => {
    expect(tables()).toEqual(
      expect.arrayContaining([
        'applications',
        'events',
        'messages',
        'review_queue',
        'schema_migrations',
        'sync_state'
      ])
    )
  })

  it('records what it applied', () => {
    const rows = db.prepare('SELECT name FROM schema_migrations').all() as unknown as { name: string }[]
    expect(rows.map((r) => r.name)).toEqual(['001_init'])
  })

  it('is a no-op when run again', () => {
    expect(migrate(db, MIGRATIONS)).toEqual([])
  })

  it('rolls back a failing migration without recording it', () => {
    const broken = [{ name: '999_broken', sql: 'CREATE TABLE ok (id INTEGER); THIS IS NOT SQL;' }]
    expect(() => migrate(db, broken)).toThrow()
    expect(tables()).not.toContain('ok')
    const recorded = db.prepare("SELECT 1 FROM schema_migrations WHERE name = '999_broken'").get()
    expect(recorded).toBeUndefined()
  })

  it('enforces foreign keys', () => {
    expect(() =>
      appendEvent(db, { application_id: 9999, type: 'applied', occurred_at: T0, source: 'email' })
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('sync state', () => {
  it('returns null for an unset key', () => {
    expect(getSyncState(db, 'history_id')).toBeNull()
  })

  it('stores and overwrites values', () => {
    setSyncState(db, 'history_id', '100')
    setSyncState(db, 'history_id', '250')
    expect(getSyncState(db, 'history_id')).toBe('250')
  })
})

describe('transaction', () => {
  const count = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM sync_state').get() as unknown as { n: number }).n

  it('commits everything written inside it', () => {
    transaction(db, () => {
      setSyncState(db, 'a', '1')
      setSyncState(db, 'b', '2')
    })
    expect(count()).toBe(2)
  })

  it('rolls back everything when it throws', () => {
    expect(() =>
      transaction(db, () => {
        setSyncState(db, 'a', '1')
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(count()).toBe(0)
  })

  it('returns the callback result', () => {
    expect(transaction(db, () => 42)).toBe(42)
  })

  it('nests without throwing', () => {
    // The sync engine commits its cursor in the same transaction as data
    // written through helpers that open their own transactions.
    transaction(db, () => {
      setSyncState(db, 'history_id', '500')
      transaction(db, () => setSyncState(db, 'inner', 'x'))
    })
    expect(getSyncState(db, 'history_id')).toBe('500')
    expect(getSyncState(db, 'inner')).toBe('x')
  })

  it('undoes committed inner work when the outer transaction fails', () => {
    // The property that matters for sync: never advance the cursor past data
    // that did not actually land.
    let innerVisible: string | null = null
    expect(() =>
      transaction(db, () => {
        transaction(db, () => setSyncState(db, 'inner', 'x'))
        // Proves the inner transaction really completed, so the rollback below
        // is undoing real work rather than work that never started.
        innerVisible = getSyncState(db, 'inner')
        setSyncState(db, 'history_id', '500')
        throw new Error('sync failed after inner write')
      })
    ).toThrow('sync failed after inner write')
    expect(innerVisible).toBe('x')
    expect(count()).toBe(0)
  })

  it('keeps outer work when only an inner transaction fails and is handled', () => {
    let innerWrote = false
    let caught: unknown = null
    transaction(db, () => {
      setSyncState(db, 'outer', 'kept')
      try {
        transaction(db, () => {
          setSyncState(db, 'inner', 'discarded')
          innerWrote = getSyncState(db, 'inner') === 'discarded'
          throw new Error('inner failure')
        })
      } catch (error) {
        // A single bad message must not abort the whole sync batch.
        caught = error
      }
    })
    // Without these, a nested transaction that fails to even start would pass.
    expect(innerWrote).toBe(true)
    expect((caught as Error).message).toBe('inner failure')
    expect(getSyncState(db, 'outer')).toBe('kept')
    expect(getSyncState(db, 'inner')).toBeNull()
  })

  it('leaves the connection usable after a rollback', () => {
    expect(() => transaction(db, () => { throw new Error('x') })).toThrow()
    transaction(db, () => setSyncState(db, 'after', 'ok'))
    expect(getSyncState(db, 'after')).toBe('ok')
  })
})

describe('applications and events', () => {
  const insertMessage = (gmailId: string): void => {
    db.prepare('INSERT INTO messages (gmail_id, received_at) VALUES (?, ?)').run(gmailId, T0)
  }

  it('normalizes the company on insert', () => {
    const id = createApplication(db, { company: 'Acme, Inc.', source: 'email', occurred_at: T0 })
    expect(getApplication(db, id)?.company_norm).toBe('acme')
  })

  it('folds stored events into a stage', () => {
    const id = createApplication(db, { company: 'Acme', source: 'email', occurred_at: T0 })
    appendEvent(db, { application_id: id, type: 'applied', occurred_at: T0, source: 'email' })
    appendEvent(db, { application_id: id, type: 'screen', occurred_at: T0 + 3 * DAY, source: 'email' })
    expect(stageOf(db, id, T0 + 4 * DAY)).toBe('screen')
  })

  it('treats a replayed email as a no-op', () => {
    // Incremental sync and full resync can both deliver the same message.
    const id = createApplication(db, { company: 'Acme', source: 'email', occurred_at: T0 })
    insertMessage('msg-1')
    const event = {
      application_id: id,
      type: 'ack' as const,
      occurred_at: T0,
      source: 'email' as const,
      gmail_id: 'msg-1'
    }

    expect(appendEvent(db, event)).toBe(true)
    expect(appendEvent(db, event)).toBe(false)

    const count = db.prepare('SELECT COUNT(*) AS n FROM events WHERE application_id = ?').get(id) as unknown as {
      n: number
    }
    expect(count.n).toBe(1)
  })

  it('does not collapse separate captures that have no gmail_id', () => {
    // Extension and manual captures carry no gmail_id, so email dedupe must
    // never merge them. Guards against a future change to the dedupe index
    // (e.g. COALESCE-ing gmail_id) silently collapsing distinct captures.
    const id = createApplication(db, { company: 'Acme', source: 'extension', occurred_at: T0 })
    const capture = { application_id: id, type: 'applied' as const, source: 'extension' as const }

    expect(appendEvent(db, { ...capture, occurred_at: T0 })).toBe(true)
    expect(appendEvent(db, { ...capture, occurred_at: T0 + DAY })).toBe(true)
  })

  it('advances last activity but never rewinds it', () => {
    const id = createApplication(db, { company: 'Acme', source: 'email', occurred_at: T0 })
    appendEvent(db, { application_id: id, type: 'screen', occurred_at: T0 + 10 * DAY, source: 'email' })
    // An older email classified late must not make the application look stale.
    appendEvent(db, { application_id: id, type: 'ack', occurred_at: T0 + 2 * DAY, source: 'email' })
    expect(getApplication(db, id)?.last_activity_at).toBe(T0 + 10 * DAY)
  })

  it('lists applications with derived stages, most recent first', () => {
    const quiet = createApplication(db, { company: 'Quiet Co', source: 'email', occurred_at: T0 })
    appendEvent(db, { application_id: quiet, type: 'ack', occurred_at: T0, source: 'email' })

    const active = createApplication(db, { company: 'Busy Co', source: 'email', occurred_at: T0 })
    appendEvent(db, { application_id: active, type: 'onsite', occurred_at: T0 + 40 * DAY, source: 'email' })

    const rejected = createApplication(db, { company: 'Nope Co', source: 'email', occurred_at: T0 })
    appendEvent(db, { application_id: rejected, type: 'rejected', occurred_at: T0 + 1 * DAY, source: 'email' })

    const now = T0 + 45 * DAY
    const list = listApplications(db, now)

    expect(list.map((a) => [a.company, a.stage])).toEqual([
      ['Busy Co', 'onsite'],
      ['Nope Co', 'rejected'],
      ['Quiet Co', 'ghosted']
    ])
  })

  it('shows an application with no events yet', () => {
    createApplication(db, { company: 'Fresh Co', source: 'manual', occurred_at: T0 })
    expect(listApplications(db, T0)[0]?.stage).toBeNull()
  })

  it('removes events when their application is deleted', () => {
    const id = createApplication(db, { company: 'Acme', source: 'email', occurred_at: T0 })
    appendEvent(db, { application_id: id, type: 'applied', occurred_at: T0, source: 'email' })
    db.prepare('DELETE FROM applications WHERE id = ?').run(id)
    const orphans = db.prepare('SELECT COUNT(*) AS n FROM events').get() as unknown as { n: number }
    expect(orphans.n).toBe(0)
  })
})
