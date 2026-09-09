import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import { z } from 'zod'
import { dedupeKeyFor, enqueueGeneration } from '../jobs/queue.js'
import { requireAuth } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { KitModel } from '../models/kit.js'

const CreateBody = z.object({
  jd: z.string().trim().min(1, 'paste the job description'),
  companyUrl: z.string().trim().min(1, 'enter the company website address'),
  days: z.number().int().positive('days must be a whole number of at least 1').max(60, 'days cannot exceed 60'),
})

const BatchBody = z.object({ cases: z.array(CreateBody).min(1, 'the file contained no cases').max(20, 'at most 20 cases at a time') })

export const kitsRouter = Router()
kitsRouter.use(requireAuth)

async function createOne(userId: string, body: z.infer<typeof CreateBody>) {
  const dedupeKey = dedupeKeyFor(userId, body.jd, body.companyUrl)
  const existing = await KitModel.findOne({ userId, dedupeKey })
  if (existing) return { doc: existing, duplicate: true }

  const doc = await KitModel.create({
    userId,
    dedupeKey,
    status: 'queued',
    input: { jd: body.jd, companyUrl: body.companyUrl, days: body.days },
  })
  enqueueGeneration(doc.id)
  return { doc, duplicate: false }
}

kitsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = CreateBody.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const { doc, duplicate } = await createOne(req.userId!, parsed.data)
    // A second submission of the same posting joins the first job.
    res.status(duplicate ? 200 : 202).json({ id: doc.id, status: doc.status, duplicate })
  } catch (error) {
    next(error)
  }
})

kitsRouter.post('/batch', async (req, res, next) => {
  try {
    const parsed = BatchBody.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'INVALID_INPUT', parsed.error.issues[0]!.message)

    const ids: string[] = []
    for (const item of parsed.data.cases) {
      const { doc } = await createOne(req.userId!, item)
      ids.push(doc.id)
    }
    res.status(202).json({ ids })
  } catch (error) {
    next(error)
  }
})

kitsRouter.get('/', async (req, res, next) => {
  try {
    const docs = await KitModel.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50).lean()
    res.json({
      kits: docs.map((doc) => ({
        id: String(doc._id),
        status: doc.status,
        // Enough to render a list card without shipping every kit body.
        role: doc.kit?.role?.title ?? doc.input.jd.slice(0, 60),
        company: doc.kit?.source?.company ?? doc.input.companyUrl,
        days: doc.input.days,
        createdAt: doc.createdAt,
        warningCount: doc.kit?.warnings?.length ?? 0,
      })),
    })
  } catch (error) {
    next(error)
  }
})

kitsRouter.get('/:id', async (req, res, next) => {
  try {
    const doc = await findOwned(req.params.id, req.userId!)
    res.json(serialise(doc))
  } catch (error) {
    next(error)
  }
})

kitsRouter.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'no such kit')
    const deleted = await KitModel.findOneAndDelete({ _id: req.params.id, userId: req.userId })
    if (!deleted) throw new HttpError(404, 'NOT_FOUND', 'no such kit')
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

/**
 * Ownership is part of the query, not a check after the fact, and a kit
 * belonging to someone else is a 404: whether it exists is not this user's
 * business.
 */
export async function findOwned(id: string, userId: string) {
  if (!isValidObjectId(id)) throw new HttpError(404, 'NOT_FOUND', 'no such kit')
  const doc = await KitModel.findOne({ _id: id, userId })
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'no such kit')
  return doc
}

export function serialise(doc: Awaited<ReturnType<typeof findOwned>>) {
  return {
    id: doc.id,
    status: doc.status,
    input: doc.input,
    progress: doc.progress,
    kit: doc.kit,
    sections: Object.fromEntries(doc.sections ?? new Map()),
    practice: doc.practice,
    error: doc.error,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}
