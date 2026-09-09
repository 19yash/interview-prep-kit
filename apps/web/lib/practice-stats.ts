import type { Flashcard } from './types'

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
