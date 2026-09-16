import type { CaptureSource, DerivedStage, EventType, StageEvent } from '@shared/types'
import { transaction, type DB } from './db'
import { deriveStage } from './fold'

export interface NewEvent {
  application_id: number
  type: EventType
  occurred_at: number
  source: CaptureSource
  gmail_id?: string | null
  confidence?: number
  extracted?: unknown
}

/**
 * Appends an event and advances the application's activity clock.
 *
 * Returns false when the event was already recorded. Replaying a message is
 * expected — both the incremental and full-resync paths can deliver the same
 * message twice — so a duplicate is a no-op rather than an error.
 */
export function appendEvent(db: DB, event: NewEvent): boolean {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO events
       (application_id, gmail_id, type, occurred_at, source, confidence, extracted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const touch = db.prepare(
    `UPDATE applications
        SET last_activity_at = MAX(last_activity_at, ?)
      WHERE id = ?`
  )

  return transaction(db, () => {
    const result = insert.run(
      event.application_id,
      event.gmail_id ?? null,
      event.type,
      event.occurred_at,
      event.source,
      event.confidence ?? 1.0,
      event.extracted === undefined ? null : JSON.stringify(event.extracted)
    )

    if (Number(result.changes) === 0) return false
    touch.run(event.occurred_at, event.application_id)
    return true
  })
}

export function listEvents(db: DB, applicationId: number): StageEvent[] {
  return db
    .prepare('SELECT type, occurred_at FROM events WHERE application_id = ? ORDER BY occurred_at')
    .all(applicationId) as unknown as StageEvent[]
}

/** Current stage for one application, ghosting included. */
export function stageOf(db: DB, applicationId: number, now?: number): DerivedStage | null {
  return deriveStage(listEvents(db, applicationId), now)
}
