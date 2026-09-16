/** Event types an email or capture can produce, in no particular order. */
export type EventType =
  | 'applied'
  | 'ack'
  | 'assessment'
  | 'screen'
  | 'onsite'
  | 'offer'
  | 'rejected'

/** Where a candidate application came from. */
export type CaptureSource = 'email' | 'sent_mail' | 'extension' | 'manual'

/** A stage as displayed to the user. `ghosted` is derived, never stored. */
export type DerivedStage = EventType | 'ghosted'

/** The minimum an event needs for the stage fold. Storage rows are a superset. */
export interface StageEvent {
  type: EventType
  /** Epoch milliseconds. */
  occurred_at: number
}

export interface ApplicationRow {
  id: number
  company: string
  company_norm: string
  role: string | null
  job_url: string | null
  source: CaptureSource
  first_seen_at: number
  last_activity_at: number
}

export interface EventRow extends StageEvent {
  id: number
  application_id: number
  gmail_id: string | null
  source: CaptureSource
  confidence: number
  extracted: string | null
}

export interface MessageRow {
  gmail_id: string
  thread_id: string | null
  from_addr: string | null
  subject: string | null
  received_at: number
  body: string | null
  label: string
  triaged: number
  classified_at: number | null
  classifier_version: string | null
}
