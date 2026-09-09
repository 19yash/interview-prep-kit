import {
  allocateSchedule,
  checkCoverage,
  nextIdAfter,
  QUESTION_CATEGORIES,
  validateKit,
  type Flashcard,
  type Kit,
  type Question,
} from '@ipk/core'
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { findOwned, serialise } from './kits.js'

export const itemsRouter = Router()
itemsRouter.use(requireAuth)

/** Every write goes through here, so an edit can never persist an invalid kit. */
async function withKit(id: string, userId: string, mutate: (kit: Kit) => void) {
  const doc = await findOwned(id, userId)
  if (!doc.kit) throw new HttpError(409, 'NOT_READY', 'this kit has not finished generating')

  const kit = structuredClone(doc.kit) as Kit
  mutate(kit)

  const validated = validateKit(kit)
  if (!validated.ok) throw new HttpError(422, 'INVALID_KIT', validated.errors.join('; '))

  doc.kit = validated.kit
  doc.markModified('kit')
  await doc.save()
  return doc
}

function recomputeCoverage(kit: Kit): void {
  const report = checkCoverage(kit.role.requirements, kit.questions)
  kit.coverage = { uncovered_requirement_ids: report.uncovered_requirement_ids, passes: kit.coverage.passes }
}

/** A deleted question must not survive as a dangling schedule reference. */
function pruneSchedule(kit: Kit): void {
  const ids = new Set(kit.questions.map((q) => q.id))
  kit.schedule.days = kit.schedule.days.map((day) => ({
    ...day,
    question_ids: day.question_ids.filter((qid) => ids.has(qid)),
  }))
}

const QuestionPatch = z
  .object({
    prompt: z.string().trim().min(1, 'a question needs a prompt').optional(),
    answer_outline: z.string().optional(),
    difficulty: z.number().int().min(1).max(3).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

itemsRouter.patch('/:id/questions/:questionId', async (req, res, next) => {
  try {
    const parsed = QuestionPatch.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const question = kit.questions.find((q) => q.id === req.params.questionId)
      if (!question) throw new HttpError(404, 'NOT_FOUND', 'no such question')

      const { pinned, ...content } = parsed.data
      if (pinned !== undefined) question.pinned = pinned
      if (Object.keys(content).length > 0) {
        Object.assign(question, content)
        // Editing is an act of ownership: this item is now immune to
        // regeneration of its category.
        question.origin = question.origin === 'manual' ? 'manual' : 'edited'
        question.rev += 1
      }
    })
    res.json(serialise(doc))
  } catch (error) {
    next(error)
  }
})

const NewQuestion = z.object({
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().trim().min(1),
  answer_outline: z.string().default(''),
  requirement_ids: z.array(z.string()).default([]),
  difficulty: z.number().int().min(1).max(3).default(2),
})

itemsRouter.post('/:id/questions', async (req, res, next) => {
  try {
    const parsed = NewQuestion.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    let created: Question | null = null
    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const question: Question = {
        id: nextIdAfter('q', kit.questions)(),
        requirement_ids: parsed.data.requirement_ids,
        category: parsed.data.category,
        prompt: parsed.data.prompt,
        answer_outline: parsed.data.answer_outline,
        difficulty: parsed.data.difficulty as 1 | 2 | 3,
        origin: 'manual',
        pinned: false,
        rev: 0,
      }
      kit.questions.push(question)
      created = question
      recomputeCoverage(kit)
    })
    res.status(201).json({ question: created, kit: serialise(doc) })
  } catch (error) {
    next(error)
  }
})

itemsRouter.delete('/:id/questions/:questionId', async (req, res, next) => {
  try {
    await withKit(req.params.id, req.userId!, (kit) => {
      const before = kit.questions.length
      kit.questions = kit.questions.filter((q) => q.id !== req.params.questionId)
      if (kit.questions.length === before) throw new HttpError(404, 'NOT_FOUND', 'no such question')
      pruneSchedule(kit)
      recomputeCoverage(kit)
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

itemsRouter.patch('/:id/questions/:questionId/category', async (req, res, next) => {
  try {
    const parsed = z.object({ category: z.enum(QUESTION_CATEGORIES) }).safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', 'unknown category')

    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const question = kit.questions.find((q) => q.id === req.params.questionId)
      if (!question) throw new HttpError(404, 'NOT_FOUND', 'no such question')
      question.category = parsed.data.category
      // A moved question is the user's arrangement, so protect it.
      if (question.origin === 'generated') question.origin = 'edited'
      question.rev += 1
    })
    res.json(serialise(doc))
  } catch (error) {
    next(error)
  }
})

itemsRouter.put('/:id/questions/order', async (req, res, next) => {
  try {
    const parsed = z.object({ ids: z.array(z.string()) }).safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', 'send the full ordered id list')

    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const current = kit.questions.map((q) => q.id)
      const sameSet =
        parsed.data.ids.length === current.length && parsed.data.ids.every((id) => current.includes(id))
      if (!sameSet) throw new HttpError(400, 'INVALID_INPUT', 'the id list must contain exactly the existing questions')

      const byId = new Map(kit.questions.map((q) => [q.id, q]))
      kit.questions = parsed.data.ids.map((id) => byId.get(id)!)
    })
    res.json(serialise(doc))
  } catch (error) {
    next(error)
  }
})

const FlashcardPatch = z
  .object({
    front: z.string().trim().min(1).optional(),
    back: z.string().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

itemsRouter.patch('/:id/flashcards/:cardId', async (req, res, next) => {
  try {
    const parsed = FlashcardPatch.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const card = kit.flashcards.find((f) => f.id === req.params.cardId)
      if (!card) throw new HttpError(404, 'NOT_FOUND', 'no such flashcard')
      const { pinned, ...content } = parsed.data
      if (pinned !== undefined) card.pinned = pinned
      if (Object.keys(content).length > 0) {
        Object.assign(card, content)
        card.origin = card.origin === 'manual' ? 'manual' : 'edited'
        card.rev += 1
      }
    })
    res.json(serialise(doc))
  } catch (error) {
    next(error)
  }
})

const NewFlashcard = z.object({
  front: z.string().trim().min(1),
  back: z.string().default(''),
  requirement_ids: z.array(z.string()).default([]),
})

itemsRouter.post('/:id/flashcards', async (req, res, next) => {
  try {
    const parsed = NewFlashcard.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    let created: Flashcard | null = null
    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const card: Flashcard = {
        id: nextIdAfter('f', kit.flashcards)(),
        front: parsed.data.front,
        back: parsed.data.back,
        requirement_ids: parsed.data.requirement_ids,
        origin: 'manual',
        pinned: false,
        rev: 0,
      }
      kit.flashcards.push(card)
      created = card
    })
    res.status(201).json({ flashcard: created, kit: serialise(doc) })
  } catch (error) {
    next(error)
  }
})

itemsRouter.delete('/:id/flashcards/:cardId', async (req, res, next) => {
  try {
    await withKit(req.params.id, req.userId!, (kit) => {
      const before = kit.flashcards.length
      kit.flashcards = kit.flashcards.filter((f) => f.id !== req.params.cardId)
      if (kit.flashcards.length === before) throw new HttpError(404, 'NOT_FOUND', 'no such flashcard')
    })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

itemsRouter.put('/:id/flashcards/order', async (req, res, next) => {
  try {
    const parsed = z.object({ ids: z.array(z.string()) }).safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', 'send the full ordered id list')

    const doc = await withKit(req.params.id, req.userId!, (kit) => {
      const current = kit.flashcards.map((f) => f.id)
      const sameSet = parsed.data.ids.length === current.length && parsed.data.ids.every((id) => current.includes(id))
      if (!sameSet) throw new HttpError(400, 'INVALID_INPUT', 'the id list must contain exactly the existing flashcards')
      const byId = new Map(kit.flashcards.map((f) => [f.id, f]))
      kit.flashcards = parsed.data.ids.map((id) => byId.get(id)!)
    })
    res.json(serialise(doc))
  } catch (error) {
    next(error)
  }
})

const BriefPatch = z
  .object({ summary: z.string().trim().min(1).optional(), what_they_do: z.string().trim().min(1).optional() })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change')

itemsRouter.patch('/:id/brief', async (req, res, next) => {
  try {
    const parsed = BriefPatch.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const doc = await findOwned(req.params.id, req.userId!)
    if (!doc.kit) throw new HttpError(409, 'NOT_READY', 'this kit has not finished generating')

    const updated = await withKit(req.params.id, req.userId!, (kit) => {
      Object.assign(kit.company_brief, parsed.data)
    })
    // The brief has no per-item origin, so the section state carries the fact
    // that a human has taken it over.
    updated.sections?.set('company_brief', {
      status: 'idle',
      rev: (updated.sections.get('company_brief')?.rev ?? 0) + 1,
      updated_at: new Date(),
      error: null,
      edited: true,
    } as never)
    updated.markModified('sections')
    await updated.save()

    res.json(serialise(updated))
  } catch (error) {
    next(error)
  }
})

/** Re-run the deterministic allocator over the current question set. */
export function reallocate(kit: Kit): void {
  kit.schedule = allocateSchedule({
    questions: kit.questions,
    requirements: kit.role.requirements,
    days: kit.schedule.days_available,
  })
}
