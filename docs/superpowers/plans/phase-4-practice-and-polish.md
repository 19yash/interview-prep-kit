# Phase 4 — Practice Mode and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kit something the user works through rather than reads: step through flashcards one at a time, reveal the answer, record how confident they felt, see what they have covered and what they have not, and have the next session ordered by what they were least confident about. Then close out the interface with the accessibility, responsiveness and empty-state pass the brief scores directly.

**Architecture:** The next-session order is computed on the server (Phase 1 Task 14) and fetched once when a session starts, so the ordering rule lives in one place and survives a reload. A session hook owns the local walk through that order — current index, revealed or not, what was rated in this sitting — and records each rating as it happens, so closing the tab mid-session loses nothing but the position.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-interview-prep-kit-design.md`

**Depends on:** Phase 1 Task 14 (`POST /api/kits/:id/practice`, `GET /api/kits/:id/practice/next`) and Phases 2–3 (API client, `useKit`, UI primitives, kit page).

## Global Constraints

- TypeScript only, `strict: true`.
- **The ordering rule is the server's.** The client renders the order it is given and never re-sorts it; a second implementation would be a second answer to the same question.
- A rating is recorded the moment it is given. Nothing is batched to the end of a session.
- Practice must be fully operable from the keyboard: space or enter reveals, `1`/`2`/`3` rate, arrows move. No mouse-only path.
- Every rating control has a text label, not only a number, and the confidence scale is explained in the interface rather than assumed.
- Coverage in practice means "cards seen", which is a different claim from requirement coverage. The two must never be conflated in the copy.
- Loading, empty and error states are required, including the case of a kit with no flashcards at all.
- No layout may scroll horizontally at 375px wide.
- Nothing regresses: `npx vitest run` and `npx tsc --noEmit -p apps/web` must stay clean.

## File Structure

```
apps/web/
  lib/
    use-practice.ts             session state and recording
    practice-stats.ts           pure summaries over the rating history
  components/
    practice/
      FlashcardPlayer.tsx       one card at a time, reveal, rate
      ConfidenceButtons.tsx     the 1-2-3 scale with labels
      SessionProgress.tsx       position, covered, remaining
      SessionSummary.tsx        end-of-session recap and weakest cards
      PracticeEmpty.tsx         no flashcards yet
      KeyboardHints.tsx
  app/
    kits/[id]/practice/page.tsx
  test/
    practice-stats.test.ts
    use-practice.test.ts
```

---

## Task 1: Rating statistics

Pure functions over the rating history the API already stores on the kit
document, so the practice views stay about presentation.

**Files:**
- Create: `apps/web/lib/practice-stats.ts`
- Test: `apps/web/test/practice-stats.test.ts`

**Interfaces:**
- Consumes: `Flashcard`, `KitDoc['practice']` from `@/lib/types`.
- Produces:
  - `type Attempt = { cardId: string; confidence: number; seenAt: string }`
  - `latestByCard(attempts: Attempt[]): Map<string, Attempt>`
  - `practiceStats(cards: Flashcard[], attempts: Attempt[]): PracticeStats`
  - `type PracticeStats = { total: number; seen: number; unseen: number; low: number; medium: number; high: number; weakest: { card: Flashcard; confidence: number }[]; lastSeenAt: string | null }`
  - `CONFIDENCE_LABELS: Record<1 | 2 | 3, string>` — `{ 1: 'Not yet', 2: 'Shaky', 3: 'Confident' }`
  - `confidenceLabel(value: number): string`

`weakest` is capped at five and ordered by confidence ascending then least
recently seen — the same tie-break the server uses for session order, so the
recap and the next session agree.

- [ ] **Step 1: Write the failing test**

`apps/web/test/practice-stats.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/practice-stats.test.ts`
Expected: FAIL — cannot resolve `../lib/practice-stats.js`.

- [ ] **Step 3: Write the statistics**

`apps/web/lib/practice-stats.ts`:

```ts
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/practice-stats.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit** — *present this message to the user; do not run it*

```
feat(web): add practice rating statistics and confidence labels
```

---

## Task 2: The practice session hook

**Files:**
- Create: `apps/web/lib/use-practice.ts`
- Test: `apps/web/test/use-practice.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError`, `Flashcard`, `PracticeOrder`.
- Produces:
  - `usePractice(args: { kitId: string; cards: Flashcard[]; client?: PracticeClient }): PracticeSession`
  - `type PracticeClient = { practiceOrder: (kitId: string) => Promise<PracticeOrder>; recordPractice: (kitId: string, cardId: string, confidence: 1 | 2 | 3) => Promise<PracticeOrder> }`
  - `type PracticeSession = { status: 'loading' | 'ready' | 'error' | 'empty'; error: string | null; queue: Flashcard[]; index: number; card: Flashcard | null; revealed: boolean; reveal: () => void; rate: (confidence: 1 | 2 | 3) => Promise<void>; next: () => void; previous: () => void; restart: () => Promise<void>; finished: boolean; ratedThisSession: Map<string, 1 | 2 | 3>; saving: boolean; covered: string[]; notCovered: string[] }`

The client is injected with a default of `api`, which is the pattern Phase 2
and Phase 3 both settled on — it makes this hook testable without module
mocking.

Behaviour the tests pin down:

- The order comes from the server once, at session start, and is resolved
  against the current cards.
- Rating a card records it, marks it in `ratedThisSession`, and advances.
- Advancing past the last card sets `finished` rather than wrapping.
- Revealing resets on every move, so the answer is never already showing.
- A failed rating keeps the position, keeps the answer revealed, and reports the
  message — losing the user's place because the network blinked would be worse
  than the failure itself.
- A deleted card in the returned order is skipped rather than rendering blank.

- [ ] **Step 1: Write the failing test**

`apps/web/test/use-practice.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePractice } from '../lib/use-practice.js'
import type { Flashcard, PracticeOrder } from '../lib/types.js'

function card(id: string): Flashcard {
  return { id, front: `front ${id}`, back: `back ${id}`, requirement_ids: ['r1'], origin: 'generated', pinned: false, rev: 0 }
}

const cards = [card('f1'), card('f2'), card('f3')]

function client(order: string[], overrides: Partial<{ record: () => Promise<PracticeOrder> }> = {}) {
  const result: PracticeOrder = { order, covered: [], notCovered: order }
  return {
    practiceOrder: vi.fn(async () => result),
    recordPractice: overrides.record
      ? vi.fn(overrides.record)
      : vi.fn(async (_kitId: string, cardId: string) => ({
          order,
          covered: [cardId],
          notCovered: order.filter((id) => id !== cardId),
        })),
  }
}

async function session(order: string[], overrides?: Parameters<typeof client>[1], deck = cards) {
  const stub = client(order, overrides)
  const rendered = renderHook(() => usePractice({ kitId: 'k1', cards: deck, client: stub }))
  await waitFor(() => expect(rendered.result.current.status).not.toBe('loading'))
  return { rendered, stub }
}

describe('usePractice', () => {
  it('uses the order the server gave, not the deck order', async () => {
    const { rendered } = await session(['f3', 'f1', 'f2'])
    expect(rendered.result.current.queue.map((item) => item.id)).toEqual(['f3', 'f1', 'f2'])
    expect(rendered.result.current.card?.id).toBe('f3')
  })

  it('starts with the answer hidden', async () => {
    const { rendered } = await session(['f1', 'f2'])
    expect(rendered.result.current.revealed).toBe(false)
  })

  it('reveals on request', async () => {
    const { rendered } = await session(['f1'])
    act(() => rendered.result.current.reveal())
    expect(rendered.result.current.revealed).toBe(true)
  })

  it('hides the answer again when moving on', async () => {
    const { rendered } = await session(['f1', 'f2'])
    act(() => rendered.result.current.reveal())
    act(() => rendered.result.current.next())
    expect(rendered.result.current.revealed).toBe(false)
    expect(rendered.result.current.card?.id).toBe('f2')
  })

  it('records a rating and advances', async () => {
    const { rendered, stub } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    expect(stub.recordPractice).toHaveBeenCalledWith('k1', 'f1', 1)
    expect(rendered.result.current.card?.id).toBe('f2')
    expect(rendered.result.current.ratedThisSession.get('f1')).toBe(1)
  })

  it('takes the covered lists from the server response', async () => {
    const { rendered } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(3)
    })
    expect(rendered.result.current.covered).toEqual(['f1'])
    expect(rendered.result.current.notCovered).toEqual(['f2'])
  })

  it('finishes after the last card rather than wrapping', async () => {
    const { rendered } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(2)
    })
    await act(async () => {
      await rendered.result.current.rate(2)
    })
    expect(rendered.result.current.finished).toBe(true)
    expect(rendered.result.current.card).toBeNull()
  })

  it('goes back to the previous card without losing its rating', async () => {
    const { rendered } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    act(() => rendered.result.current.previous())
    expect(rendered.result.current.card?.id).toBe('f1')
    expect(rendered.result.current.ratedThisSession.get('f1')).toBe(1)
  })

  it('will not go back past the first card', async () => {
    const { rendered } = await session(['f1', 'f2'])
    act(() => rendered.result.current.previous())
    expect(rendered.result.current.index).toBe(0)
  })

  it('keeps the position and reports the message when a rating fails', async () => {
    class ApiErrorish extends Error {}
    const { rendered } = await session(['f1', 'f2'], {
      record: async () => {
        throw new ApiErrorish('could not save that')
      },
    })
    act(() => rendered.result.current.reveal())
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    expect(rendered.result.current.card?.id).toBe('f1')
    expect(rendered.result.current.revealed).toBe(true)
    expect(rendered.result.current.error).toBeTruthy()
  })

  it('skips an id in the order that no longer has a card', async () => {
    const { rendered } = await session(['gone', 'f1'])
    expect(rendered.result.current.queue.map((item) => item.id)).toEqual(['f1'])
  })

  it('reports an empty deck rather than a broken session', async () => {
    const { rendered } = await session([], undefined, [])
    expect(rendered.result.current.status).toBe('empty')
    expect(rendered.result.current.card).toBeNull()
  })

  it('falls back to the deck order when the server order is empty but cards exist', async () => {
    const { rendered } = await session([])
    expect(rendered.result.current.queue.map((item) => item.id)).toEqual(['f1', 'f2', 'f3'])
  })

  it('reports an error state when the order cannot be fetched', async () => {
    const stub = {
      practiceOrder: vi.fn(async () => {
        throw new Error('no such kit')
      }),
      recordPractice: vi.fn(),
    }
    const rendered = renderHook(() => usePractice({ kitId: 'k1', cards, client: stub as never }))
    await waitFor(() => expect(rendered.result.current.status).toBe('error'))
    expect(rendered.result.current.error).toBeTruthy()
  })

  it('restarts with a freshly fetched order', async () => {
    const { rendered, stub } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    await act(async () => {
      await rendered.result.current.restart()
    })
    expect(stub.practiceOrder).toHaveBeenCalledTimes(2)
    expect(rendered.result.current.index).toBe(0)
    expect(rendered.result.current.ratedThisSession.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/use-practice.test.ts`
Expected: FAIL — cannot resolve `../lib/use-practice.js`.

- [ ] **Step 3: Write the hook**

`apps/web/lib/use-practice.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { Flashcard, PracticeOrder } from './types'

export type PracticeClient = {
  practiceOrder: (kitId: string) => Promise<PracticeOrder>
  recordPractice: (kitId: string, cardId: string, confidence: 1 | 2 | 3) => Promise<PracticeOrder>
}

type Status = 'loading' | 'ready' | 'error' | 'empty'

/**
 * The walk through one sitting. The order itself is the server's decision —
 * confidence ascending, least recently seen breaking ties — so it survives a
 * reload and there is only one implementation of the rule. Ratings are sent as
 * they are given rather than batched, so abandoning a session halfway still
 * counts for the work that was done.
 */
export function usePractice({
  kitId,
  cards,
  client = api,
}: {
  kitId: string
  cards: Flashcard[]
  client?: PracticeClient
}) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<Flashcard[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ratedThisSession, setRatedThisSession] = useState<Map<string, 1 | 2 | 3>>(new Map())
  const [covered, setCovered] = useState<string[]>([])
  const [notCovered, setNotCovered] = useState<string[]>([])

  const resolve = useCallback(
    (order: string[]): Flashcard[] => {
      const byId = new Map(cards.map((card) => [card.id, card]))
      const resolved = order
        .map((id) => byId.get(id))
        .filter((card): card is Flashcard => card !== undefined)
      // An order that resolves to nothing but a non-empty deck means the two
      // have drifted; the deck is the truth to fall back on.
      return resolved.length > 0 ? resolved : cards
    },
    [cards],
  )

  const start = useCallback(async () => {
    if (cards.length === 0) {
      setQueue([])
      setStatus('empty')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      const result = await client.practiceOrder(kitId)
      setQueue(resolve(result.order))
      setCovered(result.covered)
      setNotCovered(result.notCovered)
      setIndex(0)
      setRevealed(false)
      setRatedThisSession(new Map())
      setStatus('ready')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'could not start a practice session')
      setStatus('error')
    }
  }, [cards.length, client, kitId, resolve])

  useEffect(() => {
    void start()
  }, [start])

  const move = useCallback(
    (delta: number) => {
      setRevealed(false)
      setIndex((current) => Math.max(0, Math.min(current + delta, queue.length)))
    },
    [queue.length],
  )

  const rate = useCallback(
    async (confidence: 1 | 2 | 3) => {
      const card = queue[index]
      if (!card) return
      setSaving(true)
      setError(null)
      try {
        const result = await client.recordPractice(kitId, card.id, confidence)
        setCovered(result.covered)
        setNotCovered(result.notCovered)
        setRatedThisSession((current) => new Map(current).set(card.id, confidence))
        setRevealed(false)
        setIndex((current) => Math.min(current + 1, queue.length))
      } catch (caught) {
        // Position and reveal state are deliberately preserved: losing the
        // user's place because a request failed is worse than the failure.
        setError(caught instanceof ApiError ? caught.message : 'that rating could not be saved')
      } finally {
        setSaving(false)
      }
    },
    [client, index, kitId, queue],
  )

  const card = status === 'ready' ? (queue[index] ?? null) : null

  return {
    status,
    error,
    queue,
    index,
    card,
    revealed,
    reveal: () => setRevealed(true),
    rate,
    next: () => move(1),
    previous: () => move(-1),
    restart: start,
    finished: status === 'ready' && queue.length > 0 && index >= queue.length,
    ratedThisSession,
    saving,
    covered,
    notCovered,
  }
}

export type PracticeSession = ReturnType<typeof usePractice>
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/use-practice.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit** — *present this message to the user; do not run it*

```
feat(web): add practice session hook driven by the server's card order
```

---

## Task 3: The practice interface

**Files:**
- Create: `apps/web/components/practice/ConfidenceButtons.tsx`
- Create: `apps/web/components/practice/SessionProgress.tsx`
- Create: `apps/web/components/practice/FlashcardPlayer.tsx`
- Create: `apps/web/components/practice/SessionSummary.tsx`
- Create: `apps/web/components/practice/PracticeEmpty.tsx`
- Create: `apps/web/components/practice/KeyboardHints.tsx`
- Create: `apps/web/app/kits/[id]/practice/page.tsx`
- Modify: `apps/web/components/kit/FlashcardList.tsx` (add the practice link)

**Interfaces:**
- Consumes: `usePractice`, `practiceStats`, `CONFIDENCE_LABELS`, `useKit`, `Button`, `Card`, `StateBlock`, `formatRelative`, `pluralise`.
- Produces:
  - `ConfidenceButtons` — props `{ onRate: (confidence: 1 | 2 | 3) => void; disabled?: boolean; current?: 1 | 2 | 3 }`
  - `SessionProgress` — props `{ index: number; total: number; covered: number; deck: number }`
  - `FlashcardPlayer` — props `{ session: PracticeSession }`
  - `SessionSummary` — props `{ stats: PracticeStats; ratedThisSession: number; onRestart: () => void; kitId: string }`
  - `PracticeEmpty` — props `{ kitId: string }`
  - `KeyboardHints`

- [ ] **Step 1: Write the confidence scale**

`apps/web/components/practice/ConfidenceButtons.tsx`:

```tsx
'use client'

import { CONFIDENCE_LABELS } from '@/lib/practice-stats'

const STYLES: Record<1 | 2 | 3, string> = {
  1: 'border-red-200 bg-white text-red-800 hover:bg-red-50',
  2: 'border-amber-200 bg-white text-amber-900 hover:bg-amber-50',
  3: 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50',
}

/**
 * Three points, each with a word as well as a number. A bare 1–3 scale makes
 * the user guess which end is good, and the numbers exist only because they
 * double as keyboard shortcuts.
 */
export function ConfidenceButtons({
  onRate,
  disabled = false,
  current,
}: {
  onRate: (confidence: 1 | 2 | 3) => void
  disabled?: boolean
  current?: 1 | 2 | 3
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="How confident did you feel?">
      {([1, 2, 3] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onRate(value)}
          aria-pressed={current === value}
          className={`flex-1 rounded-md border px-3 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${STYLES[value]} ${
            current === value ? 'ring-2 ring-offset-1' : ''
          }`}
        >
          {CONFIDENCE_LABELS[value]}
          <span className="ml-1.5 text-xs font-normal opacity-60" aria-hidden="true">
            {value}
          </span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write the progress strip and keyboard hints**

`apps/web/components/practice/SessionProgress.tsx`:

```tsx
import { pluralise } from '@/lib/format'

export function SessionProgress({
  index,
  total,
  covered,
  deck,
}: {
  index: number
  total: number
  covered: number
  deck: number
}) {
  const position = Math.min(index + 1, total)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600">
        <span>
          Card {position} of {total}
        </span>
        {/* "Covered" here means cards seen at some point, which is not the same
            claim as requirement coverage — the wording keeps them apart. */}
        <span>
          {covered} of {deck} cards seen so far
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={position}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label="Position in this session"
      >
        <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${(position / Math.max(total, 1)) * 100}%` }} />
      </div>
      <p className="sr-only">{pluralise(deck - covered, 'card')} not yet seen.</p>
    </div>
  )
}
```

`apps/web/components/practice/KeyboardHints.tsx`:

```tsx
const HINTS = [
  { keys: 'Space', action: 'reveal the answer' },
  { keys: '1 / 2 / 3', action: 'rate your confidence' },
  { keys: '→', action: 'skip without rating' },
  { keys: '←', action: 'go back' },
]

export function KeyboardHints() {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {HINTS.map((hint) => (
        <div key={hint.keys} className="flex items-center gap-1.5">
          <dt>
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[11px] text-slate-700">{hint.keys}</kbd>
          </dt>
          <dd>{hint.action}</dd>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 3: Write the player**

`apps/web/components/practice/FlashcardPlayer.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfidenceButtons } from '@/components/practice/ConfidenceButtons'
import { KeyboardHints } from '@/components/practice/KeyboardHints'
import { SessionProgress } from '@/components/practice/SessionProgress'
import type { PracticeSession } from '@/lib/use-practice'

export function FlashcardPlayer({ session, deckSize }: { session: PracticeSession; deckSize: number }) {
  const { card, revealed, reveal, rate, next, previous, saving, error, index, queue, covered, ratedThisSession } = session

  /**
   * Keyboard first: the whole session is operable without a pointer. Handlers
   * are skipped while focus is in a form control so the shortcuts never eat
   * someone's typing.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
      if (!card) return

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (!revealed) reveal()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
        return
      }
      if (['1', '2', '3'].includes(event.key)) {
        event.preventDefault()
        if (!revealed) reveal()
        else void rate(Number(event.key) as 1 | 2 | 3)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [card, revealed, reveal, rate, next, previous])

  if (!card) return null

  return (
    <div className="space-y-4">
      <SessionProgress index={index} total={queue.length} covered={covered.length} deck={deckSize} />

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error} — your place has been kept, try rating again.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Question</p>
        <p className="mt-2 max-w-prose text-lg font-medium leading-relaxed text-slate-900">{card.front}</p>

        {/* aria-live so a screen reader announces the answer when it appears
            rather than leaving it silently in the page. */}
        <div className="mt-6 border-t border-slate-100 pt-6" aria-live="polite">
          {revealed ? (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Answer</p>
              <p className="mt-2 max-w-prose leading-relaxed text-slate-800">{card.back || 'This card has no answer written yet.'}</p>
            </>
          ) : (
            <Button onClick={reveal} variant="secondary">
              Reveal the answer
            </Button>
          )}
        </div>
      </div>

      {revealed && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">How confident did you feel?</p>
          <ConfidenceButtons onRate={(confidence) => void rate(confidence)} disabled={saving} current={ratedThisSession.get(card.id)} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={previous} disabled={index === 0}>
          ← Back
        </Button>
        <Button variant="ghost" size="sm" onClick={next}>
          Skip without rating →
        </Button>
      </div>

      <KeyboardHints />
    </div>
  )
}
```

- [ ] **Step 4: Write the summary and the empty state**

`apps/web/components/practice/SessionSummary.tsx`:

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { confidenceLabel, type PracticeStats } from '@/lib/practice-stats'
import { pluralise } from '@/lib/format'

export function SessionSummary({
  stats,
  ratedThisSession,
  onRestart,
  kitId,
}: {
  stats: PracticeStats
  ratedThisSession: number
  onRestart: () => void
  kitId: string
}) {
  return (
    <Card title="Session finished">
      <div className="space-y-5">
        <p className="max-w-prose text-sm text-slate-700">
          You rated {pluralise(ratedThisSession, 'card')} this sitting. Across the whole deck you have seen {stats.seen}{' '}
          of {stats.total}
          {stats.unseen > 0 && `, with ${pluralise(stats.unseen, 'card')} still untouched`}.
        </p>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          {(
            [
              ['Not yet', stats.low, 'text-red-800'],
              ['Shaky', stats.medium, 'text-amber-900'],
              ['Confident', stats.high, 'text-emerald-800'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="rounded-md border border-slate-200 p-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>

        {stats.weakest.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-800">Start with these next time</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Ordered by lowest confidence, then by longest since you last saw them — which is exactly the order the
              next session will use.
            </p>
            <ul className="mt-2 divide-y divide-slate-100">
              {stats.weakest.map(({ card, confidence }) => (
                <li key={card.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 text-slate-800">{card.front}</span>
                  <span className="shrink-0 text-xs text-slate-500">{confidenceLabel(confidence)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={onRestart}>Practise again</Button>
          <Link href={`/kits/${kitId}`}>
            <Button variant="secondary">Back to the kit</Button>
          </Link>
        </div>
      </div>
    </Card>
  )
}
```

`apps/web/components/practice/PracticeEmpty.tsx`:

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'

export function PracticeEmpty({ kitId }: { kitId: string }) {
  return (
    <StateBlock
      state="empty"
      title="No flashcards to practise"
      detail="This kit has no flashcards yet — either none were generated, or they were all deleted. Add one by hand on the kit page, or regenerate the flashcards."
      action={
        <Link href={`/kits/${kitId}`}>
          <Button variant="secondary">Back to the kit</Button>
        </Link>
      }
    />
  )
}
```

- [ ] **Step 5: Write the practice page**

`apps/web/app/kits/[id]/practice/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { FlashcardPlayer } from '@/components/practice/FlashcardPlayer'
import { PracticeEmpty } from '@/components/practice/PracticeEmpty'
import { SessionSummary } from '@/components/practice/SessionSummary'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { practiceStats } from '@/lib/practice-stats'
import { useKit } from '@/lib/use-kit'
import { usePractice } from '@/lib/use-practice'
import type { KitDoc } from '@/lib/types'

function Session({ doc }: { doc: KitDoc }) {
  const cards = doc.kit?.flashcards ?? []
  const session = usePractice({ kitId: doc.id, cards })
  const stats = practiceStats(cards, doc.practice)

  if (session.status === 'empty') return <PracticeEmpty kitId={doc.id} />
  if (session.status === 'loading') return <StateBlock state="loading" title="Setting up your session" />
  if (session.status === 'error') {
    return (
      <StateBlock
        state="error"
        title="Could not start a practice session"
        detail={session.error ?? undefined}
        action={<Button onClick={() => void session.restart()}>Try again</Button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Practice</h1>
          <p className="text-sm text-slate-600">{doc.kit?.role.title ?? 'This kit'}</p>
        </div>
        <Link href={`/kits/${doc.id}`}>
          <Button variant="secondary" size="sm">
            Back to the kit
          </Button>
        </Link>
      </div>

      {session.finished ? (
        <SessionSummary
          stats={practiceStats(cards, doc.practice)}
          ratedThisSession={session.ratedThisSession.size}
          onRestart={() => void session.restart()}
          kitId={doc.id}
        />
      ) : (
        <FlashcardPlayer session={session} deckSize={stats.total} />
      )}
    </div>
  )
}

function PracticeView({ id }: { id: string }) {
  const { doc, loading, error } = useKit(id)

  if (loading) return <StateBlock state="loading" title="Loading this kit" />
  if (error || !doc) {
    return (
      <StateBlock
        state="error"
        title="Could not load this kit"
        detail={error ?? 'it may have been deleted'}
        action={
          <Link href="/kits">
            <Button variant="secondary">Back to my kits</Button>
          </Link>
        }
      />
    )
  }
  if (!doc.kit) {
    return (
      <StateBlock
        state="empty"
        title="This kit is still being built"
        detail="Practice becomes available once generation finishes."
        action={
          <Link href={`/kits/${id}`}>
            <Button variant="secondary">Watch it build</Button>
          </Link>
        }
      />
    )
  }

  return <Session doc={doc} />
}

export default function PracticePage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <PracticeView id={params.id} />
    </RequireAuth>
  )
}
```

Note the structure: `useKit` is called in `PracticeView` and `usePractice` in
`Session`, so neither hook sits below an early return. Keep that split.

**The `doc.practice` freshness problem:** ratings are recorded through
`usePractice`, which does not refresh the kit document, so the summary would
show a stale history. Fix it by having `Session` also take `refresh` from
`useKit` and call it once when `session.finished` becomes true:

```tsx
useEffect(() => {
  if (session.finished) void refresh()
}, [session.finished, refresh])
```

Add that, and pass `refresh` down from `PracticeView`.

- [ ] **Step 6: Add the practice link to the flashcard list**

In `apps/web/components/kit/FlashcardList.tsx`, replace the placeholder
`actions` block from Phase 3 with a real link. The component needs the kit id,
so add a `kitId: string` prop and pass it from the kit page:

```tsx
actions={
  kit.flashcards.length > 0 ? (
    <Link href={`/kits/${kitId}/practice`}>
      <Button size="sm">Practise these</Button>
    </Link>
  ) : undefined
}
```

- [ ] **Step 7: Verify by hand**

1. Open practice on a kit with cards — the first card shows, answer hidden.
2. Press Space — the answer appears. Press `1` — the rating is recorded and the next card shows with the answer hidden.
3. Press `2` on a hidden card — it reveals first rather than rating something unseen.
4. Rate every card — the summary appears with the three buckets and the weakest list.
5. Press Practise again — a fresh order arrives, lowest-confidence cards first.
6. Reload mid-session — earlier ratings are still counted; only the position resets.
7. Stop the API and rate — the message appears, the card stays put, the answer stays revealed.
8. Delete every flashcard on the kit page, then open practice — the empty state, not a blank card.
9. Open practice on a kit that is still generating — the "still being built" state.
10. Tab through: reveal, all three ratings, back and skip are all reachable with a visible focus ring.
11. At 375px wide: the three confidence buttons wrap or shrink without overflow.

- [ ] **Step 8: Commit** — *present this message to the user; do not run it*

```
feat(web): add practice mode with confidence rating and session summary
```

---

## Task 4: Accessibility, responsiveness and empty-state pass

Ten of the forty-five human-review points are interaction design: loading,
empty and error states, responsiveness, and keyboard access. This task is a
sweep rather than a feature, and every fix belongs to a check below.

**Files:**
- Modify: whichever components fail a check. Expect `QuestionCard`, `SectionTabs`, `EditableText`, `TopBar`, `ScheduleView`.
- Create: `apps/web/components/ui/VisuallyHidden.tsx` if a fix needs it.

- [ ] **Step 1: Keyboard sweep**

Walk the whole application with the mouse untouched. Every one of these must
hold; fix what does not.

- Skip link is the first stop and moves focus to `#main`.
- The top bar, both auth forms, the create form, the file input and the tab list are all reachable in a sensible order.
- Kit section tabs respond to arrow keys and the panel follows.
- In the builder: edit a prompt, commit with the keyboard, reorder with the arrow buttons, change category with the select, pin, delete with the two-step confirm — all without a pointer.
- Practice: reveal, rate, skip, go back.
- No control is reachable but invisible, and none has its focus ring suppressed.
- No keyboard trap: focus can always leave a card or a dialog.

- [ ] **Step 2: Screen-reader labelling sweep**

- Every icon-only control has an `aria-label` naming the item it acts on — `Move q3 earlier`, not `Move up`.
- Both progress bars expose `role="progressbar"` with current, min and max.
- The revealed answer is inside an `aria-live="polite"` region.
- Each status badge's meaning is in text, never colour alone.
- Every form control has a `<label>` or `aria-label`; every error uses `role="alert"`.
- Pin and confidence buttons expose `aria-pressed`.
- The reorder arrows `↑` and `↓` are marked `aria-hidden` inside labelled buttons, so a screen reader reads the label rather than the glyph.

- [ ] **Step 3: Responsive sweep at 375px, 768px and 1280px**

- No horizontal scrolling anywhere. Check the schedule, the question cards and the sources list, which are the likely offenders.
- Card action rows wrap rather than compress into unusable targets.
- Long unbroken strings — a URL in the sources list, a pasted description — wrap or truncate. Add `break-words` or `truncate` where they do not.
- Tap targets are at least 40px tall on touch widths; bump `size="sm"` buttons where they are the only control.
- The question textarea and the schedule list are usable one-handed at 375px.

- [ ] **Step 4: Empty and error state audit**

Every one of these must have been seen with your own eyes, not assumed:

| Situation | Expected |
|---|---|
| No kits | Empty state with a working action |
| Kit still generating | Progress panel with named steps |
| Kit failed outright | Error state with the reason and a route onward |
| Kit ready but with warnings | Warning list expanded from a summary, kit fully readable |
| Zero requirements extracted | Role section explains why, no invented content |
| Zero questions in a category | Per-category empty state offering add or regenerate |
| Zero flashcards | Flashcard empty state, and practice shows its own |
| No company pages retrieved | Brief states it honestly, sources list explains |
| Coverage gap remaining | Coverage notice names each uncovered requirement |
| API unreachable | Readable message, no stack trace, retry offered |
| Session expired mid-use | Bounced to login rather than looping on 401s |

For the expired-session case, add a single guard in `lib/api.ts`: on a 401 with
code `SESSION_EXPIRED`, dispatch a `window` event that `AuthProvider` listens
for and treats as a sign-out. Without it the interface retries against a dead
cookie and shows errors instead of a login page.

```ts
// in lib/api.ts, inside the !response.ok branch
if (response.status === 401 && (error?.code === 'SESSION_EXPIRED' || error?.code === 'UNAUTHENTICATED')) {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ipk:signed-out'))
}
```

```ts
// in AuthProvider
useEffect(() => {
  function onSignedOut() {
    setUser(null)
    setStatus('signedOut')
  }
  window.addEventListener('ipk:signed-out', onSignedOut)
  return () => window.removeEventListener('ipk:signed-out', onSignedOut)
}, [])
```

Guard it so the `/api/auth/me` probe on first load does not trigger a redirect
loop — that call is expected to 401 for a signed-out visitor, so skip the
dispatch when the path is `/api/auth/me`.

- [ ] **Step 5: Copy pass**

The brief cares that honest degradation is communicated. Read every string as a
user who does not know how the system works:

- No jargon from the pipeline leaks into user-facing copy except in the progress panel, where the step names are the point.
- Warnings explain the consequence, not only the cause: "no careers page could be found, so the questions are based on the job description alone".
- Nothing overclaims. A kit built from a thin description says so on the kit, not only in a collapsed warning list.
- Error messages say what to do next where there is anything to do.

- [ ] **Step 6: Final check**

Run: `npx vitest run` then `npx tsc --noEmit -p apps/web` and `npm run typecheck`
Expected: everything green.

- [ ] **Step 7: Commit** — *present this message to the user; do not run it*

```
fix(web): accessibility, responsive and empty-state pass across the interface
```

---

## Phase 4 done when

- A user can step through flashcards one at a time, reveal, and rate confidence, entirely by keyboard.
- What has been covered and what has not is visible during and after a session, worded so it is not confused with requirement coverage.
- The next session is ordered by lowest confidence, then longest unseen — computed once, on the server.
- A rating survives a reload; a failed rating keeps the user's place.
- Every situation in the empty-state audit table has been seen and looks deliberate.
- Nothing scrolls horizontally at 375px, and no control is mouse-only.
- An expired session lands the user on the login page rather than in a retry loop.
- `npx vitest run`, `npx tsc --noEmit -p apps/web` and `npm run typecheck` are all clean.

Next: `phase-5-deploy-and-readme.md` — deployment, environment documentation,
README and the walkthrough video.
