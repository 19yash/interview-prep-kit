import { z } from 'zod'
import type { PipelineWarning } from '../fetch/discover.js'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE, wrapUntrusted } from '../llm/untrusted.js'
import { QUESTION_CATEGORIES, type Question, type Requirement, type Role } from '../schema/kit.js'
import type { HiringSignals } from './find-hiring-process.js'
import type { PublicDiscussion } from './search-public.js'

export type Category = Question['category']

export function createIdFactory(prefix: 'q' | 'f', startAt = 1): () => string {
  let n = startAt
  return () => `${prefix}${n++}`
}

/** A requirement's kind chooses its category. Deterministic and explainable. */
export function categoryForRequirement(requirement: Requirement): Category {
  if (requirement.kind === 'behavioural') return 'behavioural'
  if (requirement.kind === 'domain') return 'company-fit'
  return 'technical'
}

const CATEGORY_BRIEFS: Record<Category, string> = {
  technical: 'Ask about concrete tools, languages and systems named in the requirement. Favour depth over trivia: how something works, how they would debug it, what trade-off they would make.',
  behavioural: 'Ask for a specific past situation. Each question should invite a story with a decision and an outcome, not a self-assessment.',
  'system-design': 'Ask the candidate to design or evolve a system that combines several of the role’s requirements. One scenario per question, with a constraint that forces a trade-off.',
  'company-fit': 'Ask what connects the candidate to this company, this domain and this role. Ground the question in what the company actually does.',
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement_ids: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          answer_outline: { type: 'string' },
          difficulty: { type: 'integer' },
        },
        required: ['requirement_ids', 'prompt', 'answer_outline', 'difficulty'],
      },
    },
  },
  required: ['questions'],
}

const Reply = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).default([]),
        prompt: z.string().default(''),
        answer_outline: z.string().default(''),
        difficulty: z.number().default(2),
      }),
    )
    .default([]),
})

export type CategoryInput = {
  category: Category
  requirements: Requirement[]
  role: Role
  hiring: HiringSignals
  publicDiscussion: PublicDiscussion
  existing: Question[]
  nextId: () => string
  llm: LlmClient
  count?: number
}

function systemFor(category: Category): string {
  return [
    `You write ${category} interview questions for a specific role.`,
    CATEGORY_BRIEFS[category],
    'Every question must reference at least one of the requirement ids you are given, and only those ids.',
    'Rate difficulty 1 (warm-up), 2 (standard) or 3 (stretch).',
    'Do not repeat a question that already exists. Do not invent requirements that were not given to you.',
    UNTRUSTED_PREAMBLE,
  ].join(' ')
}

function contextBlock(input: CategoryInput): string {
  const parts: string[] = [`Role: ${input.role.title} (${input.role.seniority})`, `Category: ${input.category}`]

  parts.push(
    'Requirements to cover:',
    input.requirements.map((r) => `- ${r.id} [${r.priority}] ${r.text}`).join('\n'),
  )

  if (input.hiring.found) {
    parts.push(
      `This company's published hiring process has these stages: ${input.hiring.stages.join(', ')}.`,
      'Weight the questions towards what those stages actually assess.',
    )
  }
  if (input.publicDiscussion.found) {
    parts.push(`Publicly reported about their process: ${wrapUntrusted('PUBLIC_DISCUSSION', input.publicDiscussion.summary, 2000)}`)
  }

  const sameCategory = input.existing.filter((q) => q.category === input.category)
  if (sameCategory.length > 0) {
    parts.push(
      'Questions that already exist in this category — do not duplicate or rephrase these:',
      sameCategory.map((q) => `- ${q.prompt}`).join('\n'),
    )
  }

  parts.push(`Write ${input.count ?? Math.min(6, Math.max(2, input.requirements.length * 2))} questions.`)
  return parts.join('\n\n')
}

/** Normalising here means a bad model response degrades rather than breaks. */
function toQuestions(input: CategoryInput, reply: z.infer<typeof Reply>): Question[] {
  const allowed = new Set(input.requirements.map((r) => r.id))
  const questions: Question[] = []

  for (const candidate of reply.questions) {
    const prompt = candidate.prompt.trim()
    if (prompt.length === 0) continue
    const requirement_ids = [...new Set(candidate.requirement_ids.filter((id) => allowed.has(id)))]
    if (requirement_ids.length === 0) continue
    questions.push({
      id: input.nextId(),
      requirement_ids,
      category: input.category,
      prompt,
      answer_outline: candidate.answer_outline.trim(),
      difficulty: Math.min(3, Math.max(1, Math.round(candidate.difficulty))) as 1 | 2 | 3,
      origin: 'generated',
      pinned: false,
      rev: 0,
    })
  }

  return questions
}

export async function generateQuestionsForCategory(input: CategoryInput): Promise<Question[]> {
  if (input.requirements.length === 0) return []
  const reply = await input.llm.generateJson(
    { system: systemFor(input.category), prompt: contextBlock(input), schema: RESPONSE_SCHEMA, temperature: 0.5 },
    (raw) => Reply.parse(raw),
  )
  return toQuestions(input, reply)
}

export type AllInput = Omit<CategoryInput, 'category' | 'count'>

/**
 * Step 7. Generates questions across categories in 1–2 calls:
 * - Call 1: Technical (and system design) covering technical requirements
 * - Call 2: Behavioural and company-fit covering behavioural and domain requirements
 * This prevents rate-limit exhaustion and 429 backoff delays while ensuring
 * every requirement is addressed.
 */
export async function generateAllQuestions(input: AllInput): Promise<{ questions: Question[]; warnings: PipelineWarning[] }> {
  const questions: Question[] = []
  const warnings: PipelineWarning[] = []

  const technicalReqs = input.requirements.filter((r) => r.kind === 'technical')
  const nonTechnicalReqs = input.requirements.filter((r) => r.kind !== 'technical')

  // Call 1: Technical
  if (technicalReqs.length > 0) {
    try {
      const techQuestions = await generateQuestionsForCategory({
        ...input,
        category: 'technical',
        requirements: technicalReqs,
        existing: input.existing,
      })
      const hasSystemDesign = input.role.seniority === 'senior' || input.role.seniority === 'lead' || technicalReqs.length >= 4
      if (hasSystemDesign && techQuestions.length > 2) {
        const sysIndex = techQuestions.findIndex((q) => q.difficulty === 3)
        if (sysIndex !== -1) {
          techQuestions[sysIndex]!.category = 'system-design'
        }
      }
      questions.push(...techQuestions)
    } catch (error) {
      warnings.push({
        step: 'generateQuestions:technical',
        source: null,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Call 2: Behavioural & Domain (Company Fit)
  if (nonTechnicalReqs.length > 0) {
    try {
      const nonTechQuestions = await generateQuestionsForCategory({
        ...input,
        category: 'behavioural',
        requirements: [...nonTechnicalReqs, ...technicalReqs],
        existing: [...input.existing, ...questions],
      })
      const domainIds = new Set(nonTechnicalReqs.filter((r) => r.kind === 'domain').map((r) => r.id))
      for (const q of nonTechQuestions) {
        if (q.requirement_ids.some((id) => domainIds.has(id))) {
          q.category = 'company-fit'
        }
      }
      questions.push(...nonTechQuestions)
    } catch (error) {
      warnings.push({
        step: 'generateQuestions:behavioural',
        source: null,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { questions, warnings }
}
