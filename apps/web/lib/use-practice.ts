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
