import { z } from 'zod'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE, wrapUntrusted } from '../llm/untrusted.js'
import { REQUIREMENT_KINDS, type Requirement, type Role } from '../schema/kit.js'

export const THIN_JD_CHARS = 400
export const THIN_REQUIREMENT_COUNT = 3

export type ExtractInput = { jd: string; llm: LlmClient }
export type ExtractResult = { role: Role; thin: boolean; company_guess: string; location: string }

export const EXTRACT_SYSTEM = [
  'You extract structured hiring requirements from a job description.',
  'Extract only what the description actually states. Never infer a requirement that is not written down.',
  'If the description is short, return few requirements. A short honest list is correct; a padded list is wrong.',
  'Mark a requirement "must" when the posting presents it as required — phrasings like "required", "must have",',
  '"you have", "we need", "essential", or a bare responsibility statement.',
  'Mark it "nice" when the posting presents it as optional — "bonus", "nice to have", "a plus", "preferred",',
  '"ideally", "desirable". A "required" line and a "bonus points for" line are not the same thing.',
  'Classify kind as technical (tools, languages, systems), behavioural (collaboration, communication, mentoring,',
  'ownership) or domain (industry or subject-matter knowledge).',
  UNTRUSTED_PREAMBLE,
].join(' ')

const ModelReply = z.object({
  title: z.string().default(''),
  seniority: z.string().default(''),
  location: z.string().default(''),
  company_guess: z.string().default(''),
  responsibilities: z.array(z.string()).default([]),
  requirements: z
    .array(
      z.object({
        text: z.string().default(''),
        kind: z.string().default('technical'),
        priority: z.string().default('must'),
      }),
    )
    .default([]),
})

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    seniority: { type: 'string' },
    location: { type: 'string' },
    company_guess: { type: 'string' },
    responsibilities: { type: 'array', items: { type: 'string' } },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: [...REQUIREMENT_KINDS] },
          priority: { type: 'string', enum: ['must', 'nice'] },
        },
        required: ['text', 'kind', 'priority'],
      },
    },
  },
  required: ['title', 'seniority', 'responsibilities', 'requirements'],
}

/**
 * Step 1 of the pipeline. Needs no retrieval, so it runs first and alone.
 * Ids are ours, not the model's: assigning them here guarantees they are
 * stable, sequential and well-formed no matter what comes back.
 */
export async function extractRequirements(input: ExtractInput): Promise<ExtractResult> {
  const jd = input.jd ?? ''

  const reply = await input.llm.generateJson(
    {
      system: EXTRACT_SYSTEM,
      prompt: [
        'Extract the role and its requirements from the job description below.',
        wrapUntrusted('JOB_DESCRIPTION', jd),
      ].join('\n\n'),
      schema: RESPONSE_SCHEMA,
      temperature: 0.1,
    },
    (raw) => ModelReply.parse(raw),
  )

  const seen = new Set<string>()
  const requirements: Requirement[] = []
  for (const candidate of reply.requirements) {
    const text = candidate.text.trim()
    if (text.length === 0) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    requirements.push({
      id: `r${requirements.length + 1}`,
      text,
      kind: (REQUIREMENT_KINDS as readonly string[]).includes(candidate.kind)
        ? (candidate.kind as Requirement['kind'])
        : 'technical',
      priority: candidate.priority === 'nice' ? 'nice' : 'must',
    })
  }

  const role: Role = {
    title: reply.title.trim() || 'Unspecified role',
    seniority: reply.seniority.trim() || 'unspecified',
    responsibilities: reply.responsibilities.map((r) => r.trim()).filter((r) => r.length > 0),
    requirements,
  }

  return {
    role,
    // Our arithmetic, not the model's opinion.
    thin: jd.trim().length < THIN_JD_CHARS || requirements.length < THIN_REQUIREMENT_COUNT,
    company_guess: reply.company_guess.trim(),
    location: reply.location.trim(),
  }
}
