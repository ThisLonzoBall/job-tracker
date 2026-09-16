import type { ApplicationRow, CaptureSource, DerivedStage } from '@shared/types'
import type { DB } from './db'
import { deriveStage } from './fold'

/**
 * Strips the noise that stops the same employer matching itself: legal
 * suffixes, punctuation and casing. "Acme, Inc." and "ACME" must collide,
 * because a confirmation email and an extension capture rarely agree on form.
 */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|ag|bv)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export interface NewApplication {
  company: string
  role?: string | null
  job_url?: string | null
  source: CaptureSource
  occurred_at: number
}

export function createApplication(db: DB, input: NewApplication): number {
  const result = db
    .prepare(
      `INSERT INTO applications
         (company, company_norm, role, job_url, source, first_seen_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.company,
      normalizeCompany(input.company),
      input.role ?? null,
      input.job_url ?? null,
      input.source,
      input.occurred_at,
      input.occurred_at
    )

  return Number(result.lastInsertRowid)
}

export function getApplication(db: DB, id: number): ApplicationRow | null {
  return (db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as unknown as ApplicationRow) ?? null
}

export interface ApplicationWithStage extends ApplicationRow {
  stage: DerivedStage | null
}

/**
 * Every application with its stage folded in.
 *
 * Reads all events in one query and groups in memory rather than folding per
 * application, so the list view stays a single round trip to SQLite.
 */
export function listApplications(db: DB, now: number = Date.now()): ApplicationWithStage[] {
  const applications = db
    .prepare('SELECT * FROM applications ORDER BY last_activity_at DESC')
    .all() as unknown as ApplicationRow[]

  const events = db
    .prepare('SELECT application_id, type, occurred_at FROM events ORDER BY occurred_at')
    .all() as unknown as { application_id: number; type: never; occurred_at: number }[]

  const byApplication = new Map<number, { type: never; occurred_at: number }[]>()
  for (const event of events) {
    const bucket = byApplication.get(event.application_id)
    if (bucket) bucket.push(event)
    else byApplication.set(event.application_id, [event])
  }

  return applications.map((application) => ({
    ...application,
    stage: deriveStage(byApplication.get(application.id) ?? [], now)
  }))
}
