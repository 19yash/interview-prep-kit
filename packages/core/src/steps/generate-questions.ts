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

const ALL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement_ids: { type: 'array', items: { type: 'string' } },
          category: { type: 'string', enum: QUESTION_CATEGORIES },
          prompt: { type: 'string' },
          answer_outline: { type: 'string' },
          difficulty: { type: 'integer' },
        },
        required: ['requirement_ids', 'category', 'prompt', 'answer_outline', 'difficulty'],
      },
    },
  },
  required: ['questions'],
}

const AllReply = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).default([]),
        category: z.string().optional(),
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

function systemForAllQuestions(): string {
  return [
    'You write interview questions for a specific role across multiple categories: technical, behavioural, system-design, and company-fit.',
    'For each question, select an appropriate category from: technical, behavioural, system-design, company-fit.',
    'Technical: Ask about concrete tools, languages and systems named in the requirement. Favour depth over trivia.',
    'Behavioural: Ask for a specific past situation inviting a story with a decision and an outcome.',
    'System Design: Ask the candidate to design or evolve a system that combines several requirements, with a constraint forcing a trade-off.',
    'Company Fit: Ask what connects the candidate to this company, domain, and role.',
    'Every question must reference at least one of the requirement ids you are given, and only those ids.',
    'Rate difficulty 1 (warm-up), 2 (standard) or 3 (stretch).',
    'Do not repeat a question that already exists. Do not invent requirements that were not given to you.',
    UNTRUSTED_PREAMBLE,
  ].join(' ')
}

function contextBlockAll(input: AllInput): string {
  const parts: string[] = [
    `Role: ${input.role.title} (${input.role.seniority})`,
    'Category: all (technical, behavioural, system-design, company-fit)',
  ]

  parts.push(
    'Requirements to cover across all categories:',
    input.requirements.map((r) => `- ${r.id} [${r.priority}] [${r.kind}] ${r.text}`).join('\n'),
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

  if (input.existing.length > 0) {
    parts.push(
      'Questions that already exist — do not duplicate or rephrase these:',
      input.existing.map((q) => `- [${q.category}] ${q.prompt}`).join('\n'),
    )
  }

  const targetCount = Math.min(12, Math.max(4, input.requirements.length * 2))
  parts.push(`Write ${targetCount} questions spanning technical, behavioural, system-design, and company-fit as relevant.`)
  return parts.join('\n\n')
}

function toAllQuestions(input: AllInput, reply: z.infer<typeof AllReply>): Question[] {
  const reqById = new Map(input.requirements.map((r) => [r.id, r]))
  const questions: Question[] = []

  for (const candidate of reply.questions) {
    const prompt = candidate.prompt.trim()
    if (prompt.length === 0) continue
    const matchedReqs = candidate.requirement_ids
      .map((id) => reqById.get(id))
      .filter((r): r is Requirement => Boolean(r))
    if (matchedReqs.length === 0) continue

    let category: Category
    if (candidate.category && (QUESTION_CATEGORIES as readonly string[]).includes(candidate.category)) {
      category = candidate.category as Category
    } else {
      category = categoryForRequirement(matchedReqs[0]!)
    }

    questions.push({
      id: input.nextId(),
      requirement_ids: [...new Set(matchedReqs.map((r) => r.id))],
      category,
      prompt,
      answer_outline: candidate.answer_outline.trim(),
      difficulty: Math.min(3, Math.max(1, Math.round(candidate.difficulty))) as 1 | 2 | 3,
      origin: 'generated',
      pinned: false,
      rev: 0,
    })
  }

  const hasSystemDesign = input.role.seniority === 'senior' || input.role.seniority === 'lead'
  if (hasSystemDesign && !questions.some((q) => q.category === 'system-design')) {
    const stretchTech = questions.find((q) => q.category === 'technical' && q.difficulty === 3)
    if (stretchTech) {
      stretchTech.category = 'system-design'
    }
  }

  return questions
}

/**
 * Step 7. Generates questions across all categories in a single LLM call.
 * This minimizes latency and avoids rate-limit exhaustion while ensuring
 * every requirement is addressed.
 */
export async function generateAllQuestions(input: AllInput): Promise<{ questions: Question[]; warnings: PipelineWarning[] }> {
  if (input.requirements.length === 0) {
    return { questions: [], warnings: [] }
  }

  try {
    const reply = await input.llm.generateJson(
      {
        system: systemForAllQuestions(),
        prompt: contextBlockAll(input),
        schema: ALL_RESPONSE_SCHEMA,
        temperature: 0.5,
      },
      (raw) => AllReply.parse(raw),
    )

    const questions = toAllQuestions(input, reply)
    return { questions, warnings: [] }
  } catch (error) {
    return {
      questions: [],
      warnings: [
        {
          step: 'generateQuestions',
          source: null,
          reason: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
}
