import { describe, expect, it } from 'vitest'
import { CONFIDENCE_LABELS, confidenceLabel, latestByCard, practiceStats, requirementConfidence } from '../lib/practice-stats.js'
import type { Flashcard, Requirement } from '../lib/types.js'

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

describe('requirementConfidence', () => {
  const req1: Requirement = { id: 'r1', text: 'React and TypeScript', kind: 'technical', priority: 'must' }
  const req2: Requirement = { id: 'r2', text: 'Distributed Systems', kind: 'technical', priority: 'nice' }
  const req3: Requirement = { id: 'r3', text: 'Cross-functional communication', kind: 'behavioural', priority: 'must' }

  const card1: Flashcard = {
    id: 'c1',
    front: 'React lifecycle',
    back: 'Mounting, updating, unmounting',
    requirement_ids: ['r1'],
    origin: 'generated',
    pinned: false,
    rev: 0,
  }
  const card2: Flashcard = {
    id: 'c2',
    front: 'TypeScript generics',
    back: 'Type parameters',
    requirement_ids: ['r1'],
    origin: 'generated',
    pinned: false,
    rev: 0,
  }
  const card3: Flashcard = {
    id: 'c3',
    front: 'CAP theorem',
    back: 'Consistency, Availability, Partition tolerance',
    requirement_ids: ['r2'],
    origin: 'generated',
    pinned: false,
    rev: 0,
  }

  it('marks requirements with no rated cards as untested', () => {
    const result = requirementConfidence([req1], [card1], [])
    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('untested')
    expect(result[0]!.score).toBeNull()
    expect(result[0]!.totalCards).toBe(1)
    expect(result[0]!.ratedCards).toBe(0)
  })

  it('calculates average score and categorizes status accurately', () => {
    // req1: card1 = 3, card2 = 3 => avg 3.0 => 'confident'
    // req2: card3 = 1 => avg 1.0 => 'needs-practice'
    const attempts = [
      { cardId: 'c1', confidence: 3, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'c2', confidence: 3, seenAt: '2026-09-08T10:01:00Z' },
      { cardId: 'c3', confidence: 1, seenAt: '2026-09-08T10:02:00Z' },
    ]
    const result = requirementConfidence([req1, req2], [card1, card2, card3], attempts)

    const r1 = result.find((r) => r.requirement.id === 'r1')!
    const r2 = result.find((r) => r.requirement.id === 'r2')!

    expect(r1.score).toBe(3)
    expect(r1.status).toBe('confident')
    expect(r1.ratedCards).toBe(2)

    expect(r2.score).toBe(1)
    expect(r2.status).toBe('needs-practice')
    expect(r2.ratedCards).toBe(1)
  })

  it('prioritizes sessionRatings over older attempts', () => {
    const attempts = [{ cardId: 'c3', confidence: 1, seenAt: '2026-09-08T10:00:00Z' }]
    const sessionRatings = new Map<string, 1 | 2 | 3>([['c3', 3]])

    const result = requirementConfidence([req2], [card3], attempts, sessionRatings)
    expect(result[0]!.score).toBe(3)
    expect(result[0]!.status).toBe('confident')
  })

  it('sorts needs-practice first, then shaky, then untested, then confident, with must-haves prioritized', () => {
    // req1: confident (3)
    // req2: nice-to-have needs-practice (1)
    // req3: must-have needs-practice (1)
    const card4: Flashcard = {
      id: 'c4',
      front: 'Tell me about a conflict',
      back: 'STAR method',
      requirement_ids: ['r3'],
      origin: 'generated',
      pinned: false,
      rev: 0,
    }

    const attempts = [
      { cardId: 'c1', confidence: 3, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'c2', confidence: 3, seenAt: '2026-09-08T10:01:00Z' },
      { cardId: 'c3', confidence: 1, seenAt: '2026-09-08T10:02:00Z' },
      { cardId: 'c4', confidence: 1, seenAt: '2026-09-08T10:03:00Z' },
    ]

    const result = requirementConfidence([req1, req2, req3], [card1, card2, card3, card4], attempts)
    // req3 is must-have with needs-practice -> index 0
    // req2 is nice-to-have with needs-practice -> index 1
    // req1 is confident -> index 2
    expect(result.map((r) => r.requirement.id)).toEqual(['r3', 'r2', 'r1'])
  })
})
