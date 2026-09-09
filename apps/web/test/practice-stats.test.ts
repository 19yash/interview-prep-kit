import { describe, expect, it } from 'vitest'
import { CONFIDENCE_LABELS, confidenceLabel, latestByCard, practiceStats } from '../lib/practice-stats.js'
import type { Flashcard } from '../lib/types.js'

function card(id: string, front = `front ${id}`): Flashcard {
  return { id, front, back: `back ${id}`, requirement_ids: ['r1'], origin: 'generated', pinned: false, rev: 0 }
}

const cards = [card('f1'), card('f2'), card('f3')]

describe('latestByCard', () => {
  it('keeps only the most recent attempt for a card', () => {
    const latest = latestByCard([
      { cardId: 'f1', confidence: 1, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'f1', confidence: 3, seenAt: '2026-09-08T11:00:00Z' },
    ])
    expect(latest.get('f1')!.confidence).toBe(3)
  })

  it('is not fooled by attempts arriving out of order', () => {
    const latest = latestByCard([
      { cardId: 'f1', confidence: 3, seenAt: '2026-09-08T11:00:00Z' },
      { cardId: 'f1', confidence: 1, seenAt: '2026-09-08T10:00:00Z' },
    ])
    expect(latest.get('f1')!.confidence).toBe(3)
  })

  it('returns an empty map for no attempts', () => {
    expect(latestByCard([]).size).toBe(0)
  })
})

describe('practiceStats', () => {
  it('counts an untouched deck as all unseen', () => {
    const stats = practiceStats(cards, [])
    expect(stats).toMatchObject({ total: 3, seen: 0, unseen: 3, low: 0, medium: 0, high: 0 })
    expect(stats.lastSeenAt).toBeNull()
  })

  it('buckets ratings by confidence', () => {
    const stats = practiceStats(cards, [
      { cardId: 'f1', confidence: 1, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'f2', confidence: 2, seenAt: '2026-09-08T10:01:00Z' },
      { cardId: 'f3', confidence: 3, seenAt: '2026-09-08T10:02:00Z' },
    ])
    expect(stats).toMatchObject({ seen: 3, unseen: 0, low: 1, medium: 1, high: 1 })
  })

  it('counts a re-rated card once, at its latest rating', () => {
    const stats = practiceStats(cards, [
      { cardId: 'f1', confidence: 1, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'f1', confidence: 3, seenAt: '2026-09-08T12:00:00Z' },
    ])
    expect(stats.seen).toBe(1)
    expect(stats.low).toBe(0)
    expect(stats.high).toBe(1)
  })

  it('orders the weakest cards by confidence, then by least recently seen', () => {
    const stats = practiceStats(cards, [
      { cardId: 'f1', confidence: 2, seenAt: '2026-09-08T12:00:00Z' },
      { cardId: 'f2', confidence: 1, seenAt: '2026-09-08T12:00:00Z' },
      { cardId: 'f3', confidence: 2, seenAt: '2026-09-08T09:00:00Z' },
    ])
    expect(stats.weakest.map((entry) => entry.card.id)).toEqual(['f2', 'f3', 'f1'])
  })

  it('excludes unseen cards from weakest, because no confidence was expressed', () => {
    const stats = practiceStats(cards, [{ cardId: 'f1', confidence: 1, seenAt: '2026-09-08T10:00:00Z' }])
    expect(stats.weakest.map((entry) => entry.card.id)).toEqual(['f1'])
  })

  it('caps weakest at five', () => {
    const many = Array.from({ length: 8 }, (_, index) => card(`f${index + 1}`))
    const attempts = many.map((item, index) => ({ cardId: item.id, confidence: 1, seenAt: `2026-09-08T10:0${index}:00Z` }))
    expect(practiceStats(many, attempts).weakest).toHaveLength(5)
  })

  it('ignores an attempt for a card that no longer exists', () => {
    const stats = practiceStats(cards, [{ cardId: 'deleted', confidence: 1, seenAt: '2026-09-08T10:00:00Z' }])
    expect(stats.seen).toBe(0)
    expect(stats.weakest).toEqual([])
  })

  it('reports the most recent sitting', () => {
    const stats = practiceStats(cards, [
      { cardId: 'f1', confidence: 1, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'f2', confidence: 2, seenAt: '2026-09-08T14:00:00Z' },
    ])
    expect(stats.lastSeenAt).toBe('2026-09-08T14:00:00Z')
  })

  it('handles an empty deck', () => {
    expect(practiceStats([], [])).toMatchObject({ total: 0, seen: 0, unseen: 0 })
  })
})

describe('confidenceLabel', () => {
  it('names each point on the scale', () => {
    expect(confidenceLabel(1)).toBe(CONFIDENCE_LABELS[1])
    expect(confidenceLabel(3)).toBe(CONFIDENCE_LABELS[3])
  })

  it('falls back rather than throwing on an unexpected value', () => {
    expect(confidenceLabel(9)).toBe('Unrated')
  })
})
