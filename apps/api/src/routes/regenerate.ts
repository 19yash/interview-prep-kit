import {
  allocateSchedule,
  buildCompanyBrief,
  checkCoverage,
  createGeminiClient,
  EMPTY_HIRING_SIGNALS,
  EMPTY_PUBLIC_DISCUSSION,
  generateFlashcards,
  generateQuestionsForCategory,
  mergeRegenerated,
  nextIdAfter,
  partitionForRegeneration,
  QUESTION_CATEGORIES,
  SECTION_KEYS,
  validateKit,
  type Kit,
  type Question,
  type SectionKey,
} from '@ipk/core'
import { Router } from 'express'
import { env, sharedGeminiKeyPool } from '../env.js'
import { getTestLlm } from '../jobs/queue.js'
import { requireAuth } from '../middleware/auth.js'
import { HttpError } from '../middleware/errors.js'
import { findOwned, serialise } from './kits.js'

export const regenerateRouter = Router()
regenerateRouter.use(requireAuth)

function categoryOf(section: SectionKey): Question['category'] | null {
  const match = /^questions_(.+)$/.exec(section)
  const category = match?.[1]
  return category && (QUESTION_CATEGORIES as readonly string[]).includes(category)
    ? (category as Question['category'])
    : null
}

/**
 * Regenerating one section may not disturb another, and may not disturb work
 * the user has done inside the section either. The new content is built
 * against a clone and only swapped in once it validates, so a failed
 * regeneration leaves the kit exactly as it was.
 */
regenerateRouter.post('/:id/regenerate/:section', async (req, res, next) => {
  const section = req.params.section as SectionKey
  try {
    if (!(SECTION_KEYS as readonly string[]).includes(section)) {
      throw new HttpError(400, 'INVALID_INPUT', 'unknown section')
    }

    const doc = await findOwned(req.params.id, req.userId!)
    if (!doc.kit) throw new HttpError(409, 'NOT_READY', 'this kit has not finished generating')

    // Fields are set explicitly rather than spread from the stored value:
    // spreading a Mongoose subdocument copies its internals, not its fields,
    // and the cast then drops `status` back to its default.
    doc.sections?.set(section, {
      status: 'regenerating',
      rev: doc.sections.get(section)?.rev ?? 0,
      updated_at: doc.sections.get(section)?.updated_at,
      error: null,
    } as never)
    doc.markModified('sections')
    await doc.save()

    const kit = structuredClone(doc.kit) as Kit
    const llm = getTestLlm() ?? createGeminiClient({ keyPool: sharedGeminiKeyPool })

    try {
      if (section === 'schedule') {
        // Deterministic: no model involved, so nothing to preserve or merge.
        kit.schedule = allocateSchedule({
          questions: kit.questions,
          requirements: kit.role.requirements,
          days: kit.schedule.days_available,
        })
      } else if (section === 'company_brief') {
        kit.company_brief = await buildCompanyBrief({
          company: kit.source.company,
          companyUrl: kit.source.company_url,
          // The pages are no longer in memory, so a brief regeneration works
          // from what the kit already recorded rather than re-crawling.
          pages: kit.company_brief.sources.map((url) => ({ url, title: '', text: kit.company_brief.summary, kind: 'about' as const })),
          publicDiscussion: EMPTY_PUBLIC_DISCUSSION,
          llm,
        })
      } else if (section === 'flashcards') {
        const { keep } = partitionForRegeneration(kit.flashcards)
        const generated = await generateFlashcards({
          requirements: kit.role.requirements,
          questions: kit.questions,
          nextId: nextIdAfter('f', kit.flashcards),
          llm,
        })
        kit.flashcards = mergeRegenerated(keep, generated.flashcards)
      } else {
        const category = categoryOf(section)
        if (!category) throw new HttpError(400, 'INVALID_INPUT', 'that section cannot be regenerated on its own')

        const inCategory = kit.questions.filter((q) => q.category === category)
        const elsewhere = kit.questions.filter((q) => q.category !== category)
        const { keep } = partitionForRegeneration(inCategory)

        const requirementIds = new Set(inCategory.flatMap((q) => q.requirement_ids))
        const requirements = kit.role.requirements.filter(
          (r) => requirementIds.has(r.id) || kit.coverage.uncovered_requirement_ids.includes(r.id),
        )

        const generated = await generateQuestionsForCategory({
          category,
          requirements: requirements.length > 0 ? requirements : kit.role.requirements,
          role: kit.role,
          hiring: EMPTY_HIRING_SIGNALS,
          publicDiscussion: EMPTY_PUBLIC_DISCUSSION,
          // Passing the survivors in stops the model rewriting what it cannot replace.
          existing: [...keep, ...elsewhere],
          nextId: nextIdAfter('q', kit.questions),
          llm,
        })

        kit.questions = [...elsewhere, ...mergeRegenerated(keep, generated)]
        kit.schedule = allocateSchedule({
          questions: kit.questions,
          requirements: kit.role.requirements,
          days: kit.schedule.days_available,
        })
        const coverage = checkCoverage(kit.role.requirements, kit.questions)
        kit.coverage = { uncovered_requirement_ids: coverage.uncovered_requirement_ids, passes: kit.coverage.passes }
      }

      const validated = validateKit(kit)
      if (!validated.ok) throw new Error(validated.errors.join('; '))

      doc.kit = validated.kit
      doc.markModified('kit')
      doc.sections?.set(section, {
        status: 'idle',
        rev: (doc.sections.get(section)?.rev ?? 0) + 1,
        updated_at: new Date(),
        error: null,
      } as never)
      doc.markModified('sections')
      await doc.save()

      res.json(serialise(doc))
    } catch (error) {
      // The clone is discarded, so the stored kit is untouched.
      doc.sections?.set(section, {
        status: 'failed',
        rev: doc.sections.get(section)?.rev ?? 0,
        updated_at: doc.sections.get(section)?.updated_at,
        error: error instanceof Error ? error.message : String(error),
      } as never)
      doc.markModified('sections')
      await doc.save()
      throw new HttpError(502, 'REGENERATION_FAILED', error instanceof Error ? error.message : String(error))
    }
  } catch (error) {
    next(error)
  }
})
