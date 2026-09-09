import { z } from 'zod'
import type { PipelineWarning } from '../fetch/discover.js'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE, wrapUntrusted } from '../llm/untrusted.js'
import type { Question, Requirement, Role } from '../schema/kit.js'
import type { HiringSignals } from './find-hiring-process.js'
import type { PublicDiscussion } from './search-public.js'
import { categoryForRequirement } from './generate-questions.js'

export type GapInput = {
  uncovered: Requirement[]
  role: Role
  hiring: HiringSignals
  publicDiscussion: PublicDiscussion
  existing: Question[]
  nextId: () => string
  llm: LlmClient
}

const SYSTEM = [
  'You write interview questions that close specific gaps in a preparation kit.',
  'Every requirement listed below currently has no question against it. Write at least one question for each,',
  'and make each question reference the requirement ids it actually covers — only ids from the list.',
  'Rate difficulty 1 (warm-up), 2 (standard) or 3 (stretch). Do not repeat an existing question.',
  UNTRUSTED_PREAMBLE,
].join(' ')

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

/**
 * Step 9. The second pass. Covers exactly the requirements the deterministic
 * coverage check reported as uncovered, naming them directly, in one call:
 * splitting the gap list by category would need one call per category and a
 * single failure would leave part of the gap open. The category of each
 * returned question is decided here from the requirement it covers, so
 * routing stays deterministic even though the call is shared.
 *
 * A failure is a warning, not an error: the kit still ships, with the gap
 * recorded honestly in `coverage`.
 */
export async function fillGaps(input: GapInput): Promise<{ questions: Question[]; warnings: PipelineWarning[] }> {
  if (input.uncovered.length === 0) return { questions: [], warnings: [] }

  const byId = new Map(input.uncovered.map((r) => [r.id, r]))

  const parts: string[] = [
    `Role: ${input.role.title} (${input.role.seniority})`,
    'Requirements with no question against them yet:',
    input.uncovered.map((r) => `- ${r.id} [${r.priority}] (${r.kind}) ${r.text}`).join('\n'),
  ]
  if (input.hiring.found) {
    parts.push(`This company's published hiring process has these stages: ${input.hiring.stages.join(', ')}.`)
  }
  if (input.publicDiscussion.found) {
    parts.push(`Publicly reported about their process: ${wrapUntrusted('PUBLIC_DISCUSSION', input.publicDiscussion.summary, 2000)}`)
  }
  if (input.existing.length > 0) {
    parts.push(
      'Questions that already exist — do not duplicate or rephrase these:',
      input.existing.map((q) => `- ${q.prompt}`).join('\n'),
    )
  }
  parts.push(`Write ${input.uncovered.length} questions, one for each requirement above.`)

  try {
    const reply = await input.llm.generateJson(
      { system: SYSTEM, prompt: parts.join('\n\n'), schema: RESPONSE_SCHEMA, temperature: 0.5 },
      (raw) => Reply.parse(raw),
    )

    const questions: Question[] = []
    for (const candidate of reply.questions) {
      const prompt = candidate.prompt.trim()
      if (prompt.length === 0) continue
      const requirement_ids = [...new Set(candidate.requirement_ids.filter((id) => byId.has(id)))]
      if (requirement_ids.length === 0) continue
      questions.push({
        id: input.nextId(),
        requirement_ids,
        // The requirement decides the category, exactly as in the first pass.
        category: categoryForRequirement(byId.get(requirement_ids[0]!)!),
        prompt,
        answer_outline: candidate.answer_outline.trim(),
        difficulty: Math.min(3, Math.max(1, Math.round(candidate.difficulty))) as 1 | 2 | 3,
        origin: 'generated',
        pinned: false,
        rev: 0,
      })
    }

    return { questions, warnings: [] }
  } catch (error) {
    return {
      questions: [],
      warnings: [{ step: 'fillGaps', source: null, reason: error instanceof Error ? error.message : String(error) }],
    }
  }
}
