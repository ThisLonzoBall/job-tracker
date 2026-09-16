import { describe, expect, it } from 'vitest'
import type { StageEvent } from '@shared/types'
import { DEFAULT_GHOST_AFTER_DAYS, deriveStage, foldStage } from './fold'

const DAY = 86_400_000
const T0 = Date.parse('2026-01-01T00:00:00Z')

const at = (type: StageEvent['type'], dayOffset: number): StageEvent => ({
  type,
  occurred_at: T0 + dayOffset * DAY
})

describe('foldStage', () => {
  it('returns null when there is nothing to fold', () => {
    expect(foldStage([])).toBeNull()
  })

  it('reports a lone application as applied', () => {
    expect(foldStage([at('applied', 0)])).toBe('applied')
  })

  it('advances to the furthest stage reached', () => {
    expect(foldStage([at('applied', 0), at('ack', 1), at('screen', 5)])).toBe('screen')
  })

  it('ignores the order events arrive in', () => {
    // Classification is async, so a later email can be processed first.
    expect(foldStage([at('screen', 5), at('applied', 0), at('ack', 1)])).toBe('screen')
  })

  it('does not regress when an earlier-stage event lands late', () => {
    expect(foldStage([at('onsite', 10), at('ack', 2)])).toBe('onsite')
  })

  it('treats a rejection as terminal even after an onsite', () => {
    expect(foldStage([at('applied', 0), at('onsite', 10), at('rejected', 12)])).toBe('rejected')
  })

  it('lets a fresh application supersede an old rejection', () => {
    // Reapplying to the same company a year later must not read as rejected.
    expect(foldStage([at('applied', 0), at('rejected', 5), at('applied', 370)])).toBe('applied')
  })

  it('keeps progressing after a superseded rejection', () => {
    expect(
      foldStage([at('rejected', 5), at('applied', 370), at('ack', 371), at('onsite', 380)])
    ).toBe('onsite')
  })

  it('reports an offer', () => {
    expect(foldStage([at('applied', 0), at('onsite', 10), at('offer', 20)])).toBe('offer')
  })
})

describe('deriveStage', () => {
  const now = T0 + 100 * DAY

  it('marks a quiet application as ghosted', () => {
    expect(deriveStage([at('applied', 0), at('ack', 1)], now)).toBe('ghosted')
  })

  it('ghosts exactly on the boundary', () => {
    const lastActivity = now - DEFAULT_GHOST_AFTER_DAYS * DAY
    expect(deriveStage([{ type: 'ack', occurred_at: lastActivity }], now)).toBe('ghosted')
  })

  it('does not ghost one millisecond early', () => {
    const lastActivity = now - DEFAULT_GHOST_AFTER_DAYS * DAY + 1
    expect(deriveStage([{ type: 'ack', occurred_at: lastActivity }], now)).toBe('ack')
  })

  it('never ghosts a rejection', () => {
    expect(deriveStage([at('applied', 0), at('rejected', 2)], now)).toBe('rejected')
  })

  it('never ghosts an offer', () => {
    // An unanswered offer is stalled, but calling it ghosted would be wrong.
    expect(deriveStage([at('applied', 0), at('offer', 2)], now)).toBe('offer')
  })

  it('leaves recent activity alone', () => {
    expect(deriveStage([at('applied', 95), at('screen', 98)], now)).toBe('screen')
  })

  it('respects a custom ghosting window', () => {
    expect(deriveStage([at('applied', 90)], now, 5)).toBe('ghosted')
    expect(deriveStage([at('applied', 98)], now, 5)).toBe('applied')
  })

  it('returns null for an application with no events', () => {
    expect(deriveStage([], now)).toBeNull()
  })
})
