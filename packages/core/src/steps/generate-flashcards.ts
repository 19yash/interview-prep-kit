import { z } from 'zod'
import type { PipelineWarning } from '../fetch/discover.js'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE } from '../llm/untrusted.js'
import type { Flashcard, Question, Requirement } from '../schema/kit.js'

const SYSTEM = [
  'You write flashcards for interview revision.',
  'The front is a single short question or prompt. The back is a compact, correct answer of one to three sentences.',
  'Each card must reference at least one of the requirement ids given to you, and only those ids.',
  'Cover the required material rather than the optional material first.',
  UNTRUSTED_PREAMBLE,
].join(' ')

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          requirement_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['front', 'back', 'requirement_ids'],
      },
    },
  },
  required: ['flashcards'],
}

const Reply = z.object({
  flashcards: z
    .array(
      z.object({
        front: z.string().default(''),
        back: z.string().default(''),
        requirement_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

export type FlashcardInput = {
  requirements: Requirement[]
  questions: Question[]
  nextId: () => string
  llm: LlmClient
}

/** Step 7b. Same shape and same failure posture as question generation. */
export async function generateFlashcards(
  input: FlashcardInput,
): Promise<{ flashcards: Flashcard[]; warnings: PipelineWarning[] }> {
  if (input.requirements.length === 0) return { flashcards: [], warnings: [] }

  const prompt = [
    'Write flashcards for these requirements:',
    input.requirements.map((r) => `- ${r.id} [${r.priority}] ${r.text}`).join('\n'),
    `Write ${Math.min(12, Math.max(3, input.requirements.length * 2))} cards.`,
  ].join('\n\n')

  try {
    const reply = await input.llm.generateJson(
      { system: SYSTEM, prompt, schema: RESPONSE_SCHEMA, temperature: 0.4 },
      (raw) => Reply.parse(raw),
    )

    const allowed = new Set(input.requirements.map((r) => r.id))
    const flashcards: Flashcard[] = []
    for (const candidate of reply.flashcards) {
      const front = candidate.front.trim()
      if (front.length === 0) continue
      const requirement_ids = [...new Set(candidate.requirement_ids.filter((id) => allowed.has(id)))]
      if (requirement_ids.length === 0) continue
      flashcards.push({
        id: input.nextId(),
        front,
        back: candidate.back.trim(),
        requirement_ids,
        origin: 'generated',
        pinned: false,
        rev: 0,
      })
    }
    return { flashcards, warnings: [] }
  } catch (error) {
    return {
      flashcards: [],
      warnings: [{ step: 'generateFlashcards', source: null, reason: error instanceof Error ? error.message : String(error) }],
    }
  }
}
