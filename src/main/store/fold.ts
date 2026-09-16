import type { DerivedStage, EventType, StageEvent } from '@shared/types'

/**
 * How far a stage advances the application. `rejected` is deliberately absent:
 * it is terminal and handled separately rather than competing on precedence.
 */
const PRECEDENCE: Record<Exclude<EventType, 'rejected'>, number> = {
  applied: 1,
  ack: 2,
  assessment: 3,
  screen: 4,
  onsite: 5,
  offer: 6
}

/** Stages from which an application can no longer go quiet. */
const TERMINAL: ReadonlySet<DerivedStage> = new Set<DerivedStage>(['rejected', 'offer'])

export const DEFAULT_GHOST_AFTER_DAYS = 30

/**
 * Collapses an application's event log into its current stage.
 *
 * Pure by design: it takes plain events rather than a database handle, so the
 * rules can be tested without the native SQLite module. Storage calls this;
 * it never calls storage.
 *
 * Rules, in order:
 *  - No events at all means there is nothing to display yet.
 *  - A rejection is terminal, but only for events up to that point. Applying
 *    to the same company again later starts the progression over rather than
 *    being swallowed by the old rejection.
 *  - Otherwise the furthest-along event wins, regardless of arrival order.
 */
export function foldStage(events: readonly StageEvent[]): DerivedStage | null {
  if (events.length === 0) return null

  const ordered = [...events].sort((a, b) => a.occurred_at - b.occurred_at)

  const lastRejection = ordered.map((e) => e.type).lastIndexOf('rejected')
  const live = lastRejection === -1 ? ordered : ordered.slice(lastRejection + 1)

  // A rejection with nothing after it is the final word.
  if (live.length === 0) return 'rejected'

  let best: DerivedStage = 'applied'
  let bestRank = 0
  for (const event of live) {
    if (event.type === 'rejected') continue
    const rank = PRECEDENCE[event.type]
    if (rank > bestRank) {
      bestRank = rank
      best = event.type
    }
  }
  return best
}

/**
 * The stage as a human should see it, which includes going quiet.
 *
 * Ghosting is derived from the clock rather than stored, so it corrects itself
 * the moment a new event lands and never needs a background job to maintain.
 */
export function deriveStage(
  events: readonly StageEvent[],
  now: number = Date.now(),
  ghostAfterDays: number = DEFAULT_GHOST_AFTER_DAYS
): DerivedStage | null {
  const stage = foldStage(events)
  if (stage === null || TERMINAL.has(stage)) return stage

  const lastActivity = Math.max(...events.map((e) => e.occurred_at))
  const silence = now - lastActivity
  return silence >= ghostAfterDays * 86_400_000 ? 'ghosted' : stage
}
