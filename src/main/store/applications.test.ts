import { describe, expect, it } from 'vitest'
import { normalizeCompany } from './applications'

describe('normalizeCompany', () => {
  it('collapses casing and punctuation', () => {
    expect(normalizeCompany('Acme, Inc.')).toBe('acme')
    expect(normalizeCompany('ACME')).toBe('acme')
  })

  it('matches the same employer written different ways', () => {
    // The email says one thing, the job page says another.
    expect(normalizeCompany('Stripe, Inc.')).toBe(normalizeCompany('stripe'))
    expect(normalizeCompany('Monzo Bank Ltd')).toBe(normalizeCompany('Monzo Bank'))
  })

  it('keeps distinct employers distinct', () => {
    expect(normalizeCompany('Acme Health')).not.toBe(normalizeCompany('Acme Robotics'))
  })

  it('handles separators and extra whitespace', () => {
    expect(normalizeCompany('  Foo-Bar   Technologies  ')).toBe('foo bar technologies')
  })

  it('survives names that are entirely suffix', () => {
    expect(normalizeCompany('Inc.')).toBe('')
  })
})
