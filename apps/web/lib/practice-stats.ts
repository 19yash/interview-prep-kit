import type { Flashcard, Requirement } from './types'

export type Attempt = { cardId: string; confidence: number; seenAt: string }

export const CONFIDENCE_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Not yet',
  2: 'Shaky',
  3: 'Confident',
}

export function confidenceLabel(value: number): string {
  return CONFIDENCE_LABELS[value as 1 | 2 | 3] ?? 'Unrated'
}

/** Only the latest rating for a card counts: practice is meant to change it. */
export function latestByCard(attempts: Attempt[]): Map<string, Attempt> {
  const latest = new Map<string, Attempt>()
  for (const attempt of attempts) {
    const existing = latest.get(attempt.cardId)
    if (!existing || new Date(attempt.seenAt) > new Date(existing.seenAt)) latest.set(attempt.cardId, attempt)
  }
  return latest
}

export type PracticeStats = {
  total: number
  seen: number
  unseen: number
  low: number
  medium: number
  high: number
  weakest: { card: Flashcard; confidence: number }[]
  lastSeenAt: string | null
}

export const WEAKEST_LIMIT = 5

export function practiceStats(cards: Flashcard[], attempts: Attempt[]): PracticeStats {
  const latest = latestByCard(attempts)
  const byId = new Map(cards.map((card) => [card.id, card]))

  let seen = 0
  let low = 0
  let medium = 0
  let high = 0
  let lastSeenAt: string | null = null

  const rated: { card: Flashcard; confidence: number; seenAt: string }[] = []

  for (const card of cards) {
    const attempt = latest.get(card.id)
    if (!attempt) continue
    seen += 1
    if (attempt.confidence <= 1) low += 1
    else if (attempt.confidence === 2) medium += 1
    else high += 1
    rated.push({ card, confidence: attempt.confidence, seenAt: attempt.seenAt })
  }

  // A rating for a deleted card is history, not a current fact about the deck.
  for (const attempt of latest.values()) {
    if (!byId.has(attempt.cardId)) continue
    if (!lastSeenAt || new Date(attempt.seenAt) > new Date(lastSeenAt)) lastSeenAt = attempt.seenAt
  }

  const weakest = rated
    .slice()
    .sort(
      (a, b) => a.confidence - b.confidence || new Date(a.seenAt).getTime() - new Date(b.seenAt).getTime(),
    )
    .slice(0, WEAKEST_LIMIT)
    .map(({ card, confidence }) => ({ card, confidence }))

  return { total: cards.length, seen, unseen: cards.length - seen, low, medium, high, weakest, lastSeenAt }
}

export type RequirementConfidenceStatus = 'confident' | 'shaky' | 'needs-practice' | 'untested'

export type RequirementConfidence = {
  requirement: Requirement
  score: number | null // average 1.0 to 3.0, or null if untested
  status: RequirementConfidenceStatus
  totalCards: number
  ratedCards: number
  cards: { card: Flashcard; confidence?: number }[]
}

export function requirementConfidence(
  requirements: Requirement[],
  cards: Flashcard[],
  attempts: Attempt[],
  sessionRatings?: Map<string, 1 | 2 | 3>,
): RequirementConfidence[] {
  const latest = latestByCard(attempts)

  const list: RequirementConfidence[] = requirements.map((requirement) => {
    const matchedCards = cards.filter((c) => c.requirement_ids?.includes(requirement.id))

    const cardRatings = matchedCards.map((card) => {
      const sessionRating = sessionRatings?.get(card.id)
      const persistedRating = latest.get(card.id)?.confidence
      const confidence = sessionRating ?? persistedRating
      return { card, confidence }
    })

    const rated = cardRatings.filter(
      (item): item is { card: Flashcard; confidence: number } => item.confidence !== undefined,
    )

    if (rated.length === 0) {
      return {
        requirement,
        score: null,
        status: 'untested' as const,
        totalCards: matchedCards.length,
        ratedCards: 0,
        cards: cardRatings,
      }
    }

    const sum = rated.reduce((acc, curr) => acc + curr.confidence, 0)
    const rawAvg = sum / rated.length
    const score = Math.round(rawAvg * 10) / 10

    let status: RequirementConfidenceStatus
    if (score >= 2.5) {
      status = 'confident'
    } else if (score >= 1.7) {
      status = 'shaky'
    } else {
      status = 'needs-practice'
    }

    return {
      requirement,
      score,
      status,
      totalCards: matchedCards.length,
      ratedCards: rated.length,
      cards: cardRatings,
    }
  })

  // Sort: needs-practice first, then shaky, then untested, then confident.
  // Within the same status group: must-have before nice-to-have.
  const STATUS_PRIORITY: Record<RequirementConfidenceStatus, number> = {
    'needs-practice': 0,
    shaky: 1,
    untested: 2,
    confident: 3,
  }

  return list.sort((a, b) => {
    const diffStatus = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
    if (diffStatus !== 0) return diffStatus
    const aMust = a.requirement.priority === 'must' ? 0 : 1
    const bMust = b.requirement.priority === 'must' ? 0 : 1
    return aMust - bMust
  })
}
