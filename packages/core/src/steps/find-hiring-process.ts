import { z } from 'zod'
import type { RetrievedPage } from '../fetch/discover.js'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE, wrapUntrusted } from '../llm/untrusted.js'

export type HiringSignals = { found: boolean; stages: string[]; summary: string; sources: string[] }

export const EMPTY_HIRING_SIGNALS: HiringSignals = { found: false, stages: [], summary: '', sources: [] }

const SYSTEM = [
  'You read pages from a company website and report only what they say about how the company interviews candidates.',
  'If the pages do not describe a hiring or interview process, say so by returning found = false and an empty stage list.',
  'Never guess a process from the industry, the company size, or common practice. Absence of information is a valid answer.',
  UNTRUSTED_PREAMBLE,
].join(' ')

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    stages: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['found', 'stages', 'summary'],
}

const Reply = z.object({
  found: z.boolean().default(false),
  stages: z.array(z.string()).default([]),
  summary: z.string().default(''),
})

/**
 * Step 4. Reads only the pages the crawler classified as hiring-related, so a
 * company with no careers page costs no tokens here. Any failure degrades to
 * an empty result: a missing hiring page is explicitly not a run failure.
 */
export async function findHiringProcess(input: { pages: RetrievedPage[]; llm: LlmClient }): Promise<HiringSignals> {
  const candidates = input.pages.filter((page) => page.kind === 'hiring' && page.text.trim().length > 0)
  if (candidates.length === 0) return EMPTY_HIRING_SIGNALS

  const blocks = candidates
    .slice(0, 3)
    .map((page, index) => `Page ${index + 1} (${page.url}):\n${wrapUntrusted(`PAGE_${index + 1}`, page.text, 6000)}`)
    .join('\n\n')

  try {
    const reply = await input.llm.generateJson(
      {
        system: SYSTEM,
        prompt: `Report how this company interviews candidates, using only the pages below.\n\n${blocks}`,
        schema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
      (raw) => Reply.parse(raw),
    )

    const stages = reply.stages.map((s) => s.trim()).filter((s) => s.length > 0)
    // "found" is our judgement, not the model's: no stages means nothing found.
    if (stages.length === 0) return EMPTY_HIRING_SIGNALS

    return { found: true, stages, summary: reply.summary.trim(), sources: candidates.map((p) => p.url) }
  } catch {
    return EMPTY_HIRING_SIGNALS
  }
}
