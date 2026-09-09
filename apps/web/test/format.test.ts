import { describe, expect, it } from 'vitest'
import { formatDuration, formatRelative, pluralise } from '../lib/format.js'

describe('formatDuration', () => {
  it('shows sub-second work in milliseconds', () => {
    expect(formatDuration(420)).toBe('420ms')
  })

  it('shows seconds with one decimal under a minute', () => {
    expect(formatDuration(4200)).toBe('4.2s')
  })

  it('shows minutes and seconds above a minute', () => {
    expect(formatDuration(95_000)).toBe('1m 35s')
  })

  it('shows zero rather than an empty string', () => {
    expect(formatDuration(0)).toBe('0ms')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-09-08T12:00:00Z')

  it('says just now for the last minute', () => {
    expect(formatRelative('2026-09-08T11:59:30Z', now)).toBe('just now')
  })

  it('counts minutes and hours', () => {
    expect(formatRelative('2026-09-08T11:40:00Z', now)).toBe('20 minutes ago')
    expect(formatRelative('2026-09-08T09:00:00Z', now)).toBe('3 hours ago')
  })

  it('counts days', () => {
    expect(formatRelative('2026-09-06T12:00:00Z', now)).toBe('2 days ago')
  })

  it('uses the singular for one', () => {
    expect(formatRelative('2026-09-08T11:00:00Z', now)).toBe('1 hour ago')
  })

  it('returns an empty string for an unparseable date rather than throwing', () => {
    expect(formatRelative('not a date', now)).toBe('')
  })
})

describe('pluralise', () => {
  it('uses the singular for one and an s-plural by default', () => {
    expect(pluralise(1, 'question')).toBe('1 question')
    expect(pluralise(3, 'question')).toBe('3 questions')
  })

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'day', 'days')).toBe('2 days')
  })

  it('pluralises zero', () => {
    expect(pluralise(0, 'question')).toBe('0 questions')
  })
})
