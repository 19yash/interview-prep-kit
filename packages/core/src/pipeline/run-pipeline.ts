import { checkCoverage } from '../coverage/check.js'
import { discoverPages, type PipelineWarning, type RetrievedPage } from '../fetch/discover.js'
import { createGeminiClient, type LlmClient } from '../llm/client.js'
import { allocateSchedule } from '../schedule/allocate.js'
import { validateKit, type Kit, type Question } from '../schema/kit.js'
import { buildCompanyBrief, NO_INFORMATION_SUMMARY } from '../steps/build-company-brief.js'
import { extractRequirements } from '../steps/extract-requirements.js'
import { fillGaps } from '../steps/fill-gaps.js'
import { EMPTY_HIRING_SIGNALS, findHiringProcess } from '../steps/find-hiring-process.js'
import { generateFlashcards } from '../steps/generate-flashcards.js'
import { createIdFactory, generateAllQuestions } from '../steps/generate-questions.js'
import { EMPTY_PUBLIC_DISCUSSION, searchPublicDiscussion } from '../steps/search-public.js'
import { createRunner } from './runner.js'
import type { Progress, ProgressReporter } from './types.js'

export const MAX_COVERAGE_PASSES = 2

export const PIPELINE_STEPS = [
  'extractRequirements',
  'discoverPages',
  'findHiringProcess',
  'searchPublicDiscussion',
  'buildCompanyBrief',
  'generateQuestions',
  'generateFlashcards',
  'checkCoverage',
  'fillGaps',
  'allocateSchedule',
  'validateKit',
] as const

export type PipelineErrorCode = 'INVALID_INPUT' | 'EXTRACTION_FAILED' | 'INVALID_KIT' | 'COMPANY_UNREACHABLE'

export type PipelineInput = {
  jd: string
  companyUrl: string
  days: number
  llm?: LlmClient
  allowPrivate?: boolean
  maxCoveragePasses?: number
  onProgress?: ProgressReporter
  now?: () => Date
}

export type PipelineResult =
  | { ok: true; kit: Kit; progress: Progress }
  | { ok: false; code: PipelineErrorCode; message: string; progress: Progress }

/**
 * The sequence, in one readable place.
 *
 * Order is not arbitrary. Extraction needs no retrieval, so it runs first and
 * alone. The homepage is useless until crawled, so discovery precedes anything
 * that reads it. Hiring signals — from the site or from public discussion —
 * are inputs to question generation, so a company that publishes a take-home
 * followed by a system design round produces a different kit from one that
 * publishes nothing. Coverage is then checked in code, the gaps are filled, and
 * only once the question set is final is the schedule allocated over it.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const runner = createRunner([...PIPELINE_STEPS], input.onProgress)
  const now = input.now ?? (() => new Date())
  const llm = input.llm ?? createGeminiClient()
  const maxPasses = Math.max(1, input.maxCoveragePasses ?? MAX_COVERAGE_PASSES)
  const extraWarnings: PipelineWarning[] = []

  const jd = (input.jd ?? '').trim()
  if (jd.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'job description is empty', progress: runner.progress() }
  }

  // Step 1 — extraction. The only step whose failure ends the run, because
  // without requirements there is nothing to generate, cover or schedule.
  const extracted = await runner.run('extractRequirements', () => extractRequirements({ jd, llm }))
  if (!extracted.ok) {
    return {
      ok: false,
      code: 'EXTRACTION_FAILED',
      message: extracted.error instanceof Error ? extracted.error.message : String(extracted.error),
      progress: runner.progress(),
    }
  }
  const { role, thin, company_guess, location } = extracted.value
  if (thin) {
    extraWarnings.push({
      step: 'extractRequirements',
      source: null,
      reason: `the job description was thin (${jd.length} characters, ${role.requirements.length} requirements extracted); this kit is correspondingly thin`,
    })
  }

  // Step 2 — crawl. An unreachable site is a warning, never fatal.
  const discovered = await runner.run('discoverPages', () =>
    discoverPages(input.companyUrl, { allowPrivate: input.allowPrivate }),
  )
  const pages: RetrievedPage[] = discovered.ok ? discovered.value.pages : []
  if (discovered.ok) extraWarnings.push(...discovered.value.warnings)

  // Steps 4 and 5 — hiring process and public discussion.
  const hiringPages = pages.filter((page) => page.kind === 'hiring')
  let hiring = EMPTY_HIRING_SIGNALS
  if (hiringPages.length === 0) {
    runner.skip('findHiringProcess', 'no hiring or careers page was discoverable on this site')
    extraWarnings.push({ step: 'findHiringProcess', source: input.companyUrl, reason: 'no hiring page found' })
  } else {
    const found = await runner.run('findHiringProcess', () => findHiringProcess({ pages, llm }))
    if (found.ok) hiring = found.value
  }

  const company = company_guess || hostnameOf(input.companyUrl)
  const publicResult = await runner.run('searchPublicDiscussion', () =>
    searchPublicDiscussion({ company, role: role.title, llm }),
  )
  const publicDiscussion = publicResult.ok ? publicResult.value : EMPTY_PUBLIC_DISCUSSION
  if (!publicDiscussion.found) {
    extraWarnings.push({ step: 'searchPublicDiscussion', source: null, reason: 'no public discussion of this company’s interview process was found' })
  }

  // Step 6 — the brief.
  const briefResult = await runner.run('buildCompanyBrief', () =>
    buildCompanyBrief({ company, companyUrl: input.companyUrl, pages, publicDiscussion, llm }),
  )
  const company_brief = briefResult.ok
    ? briefResult.value
    : { summary: NO_INFORMATION_SUMMARY, what_they_do: 'Not established from available sources.', sources: [] }

  // Step 7 — questions, one call per category, informed by what was found.
  const nextQuestionId = createIdFactory('q')
  let questions: Question[] = []
  const generated = await runner.run('generateQuestions', () =>
    generateAllQuestions({
      requirements: role.requirements,
      role,
      hiring,
      publicDiscussion,
      existing: [],
      nextId: nextQuestionId,
      llm,
    }),
  )
  if (generated.ok) {
    questions = generated.value.questions
    extraWarnings.push(...generated.value.warnings)
  }

  const cards = await runner.run('generateFlashcards', () =>
    generateFlashcards({ requirements: role.requirements, questions, nextId: createIdFactory('f'), llm }),
  )
  const flashcards = cards.ok ? cards.value.flashcards : []
  if (cards.ok) extraWarnings.push(...cards.value.warnings)

  // Steps 8 and 9 — the loop. Check in code, fill the gaps, check again.
  let passes = 0
  let coverage = checkCoverage(role.requirements, questions)
  await runner.run('checkCoverage', async () => {
    passes = 1
    return coverage
  })

  while (!coverage.is_complete && passes < maxPasses) {
    const uncovered = role.requirements.filter((r) => coverage.uncovered_requirement_ids.includes(r.id))
    const filled = await runner.run('fillGaps', () =>
      fillGaps({ uncovered, role, hiring, publicDiscussion, existing: questions, nextId: nextQuestionId, llm }),
    )
    passes += 1
    if (!filled.ok) break
    extraWarnings.push(...filled.value.warnings)
    if (filled.value.questions.length === 0) break
    questions = [...questions, ...filled.value.questions]
    coverage = checkCoverage(role.requirements, questions)
  }
  if (coverage.is_complete && passes === 1) runner.skip('fillGaps', 'no gaps after the first pass')
  if (coverage.uncovered_must_ids.length > 0) {
    extraWarnings.push({
      step: 'checkCoverage',
      source: null,
      reason: `after ${passes} passes these must-have requirements still have no question: ${coverage.uncovered_must_ids.join(', ')}`,
    })
  }

  // Step 10 — arithmetic over the final question set.
  const scheduleResult = await runner.run('allocateSchedule', async () =>
    allocateSchedule({ questions, requirements: role.requirements, days: input.days }),
  )
  const schedule = scheduleResult.ok
    ? scheduleResult.value
    : allocateSchedule({ questions: [], requirements: [], days: input.days })

  const kit: Kit = {
    source: {
      company,
      company_url: input.companyUrl,
      role: role.title,
      location,
      jd_chars: jd.length,
      researched_at: now().toISOString(),
      pages_used: pages.map((page) => page.url),
    },
    company_brief,
    role,
    questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: coverage.uncovered_requirement_ids, passes },
    warnings: [...runner.warnings(), ...extraWarnings],
  }

  // Step 11 — the gate. Nothing is persisted or written that fails this.
  const validated = await runner.run('validateKit', async () => {
    const result = validateKit(kit)
    if (!result.ok) throw new Error(result.errors.join('; '))
    return result.kit
  })
  if (!validated.ok) {
    return {
      ok: false,
      code: 'INVALID_KIT',
      message: validated.error instanceof Error ? validated.error.message : String(validated.error),
      progress: runner.progress(),
    }
  }

  return { ok: true, kit: validated.value, progress: runner.progress() }
}

function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}
