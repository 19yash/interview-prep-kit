import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { findOwned } from './kits.js'

export const practiceRouter = Router()
practiceRouter.use(requireAuth)

const Attempt = z.object({ cardId: z.string().min(1), confidence: z.number().int().min(1).max(3) })

type Attempted = { cardId: string; confidence: number; seenAt: Date }

/**
 * Confidence-weighted ordering rather than a spaced-repetition interval.
 * The user has days before an interview, not months, so an algorithm designed
 * for long-term retention would push cards past the date they need them.
 * Unseen cards come first, then the least confident, then the least recently
 * seen — which is the order a person would choose if they were sorting the
 * pile by hand.
 */
function orderCards(cardIds: string[], attempts: Attempted[]) {
  const latest = new Map<string, Attempted>()
  for (const attempt of attempts) {
    const existing = latest.get(attempt.cardId)
    if (!existing || new Date(attempt.seenAt) > new Date(existing.seenAt)) latest.set(attempt.cardId, attempt)
  }

  const order = [...cardIds].sort((a, b) => {
    const left = latest.get(a)
    const right = latest.get(b)
    if (!left && !right) return cardIds.indexOf(a) - cardIds.indexOf(b)
    if (!left) return -1
    if (!right) return 1
    if (left.confidence !== right.confidence) return left.confidence - right.confidence
    return new Date(left.seenAt).getTime() - new Date(right.seenAt).getTime()
  })

  const covered = cardIds.filter((id) => latest.has(id))
  return { order, covered, notCovered: cardIds.filter((id) => !latest.has(id)) }
}

practiceRouter.post('/:id/practice', async (req, res, next) => {
  try {
    const parsed = Attempt.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const doc = await findOwned(req.params.id, req.userId!)
    const cardIds = (doc.kit?.flashcards ?? []).map((card: { id: string }) => card.id)
    if (!cardIds.includes(parsed.data.cardId)) throw new HttpError(404, 'NOT_FOUND', 'no such flashcard')

    doc.practice.push({ cardId: parsed.data.cardId, confidence: parsed.data.confidence, seenAt: new Date() })
    await doc.save()

    res.json(orderCards(cardIds, doc.practice as Attempted[]))
  } catch (error) {
    next(error)
  }
})

practiceRouter.get('/:id/practice/next', async (req, res, next) => {
  try {
    const doc = await findOwned(req.params.id, req.userId!)
    const cardIds = (doc.kit?.flashcards ?? []).map((card: { id: string }) => card.id)
    res.json(orderCards(cardIds, doc.practice as Attempted[]))
  } catch (error) {
    next(error)
  }
})
