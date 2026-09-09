import { z } from 'zod'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE, wrapUntrusted } from '../llm/untrusted.js'

export type PublicDiscussion = { found: boolean; summary: string; sources: string[] }

export const EMPTY_PUBLIC_DISCUSSION: PublicDiscussion = { found: false, summary: '', sources: [] }

const SUMMARY_SYSTEM = [
  'You summarise what candidates have publicly reported about a company’s interview process.',
  'Use only the search result text provided. If it contains nothing specific about interviewing at this company,',
  'return found = false. Never fill the gap with generic interview advice.',
  UNTRUSTED_PREAMBLE,
].join(' ')

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { found: { type: 'boolean' }, summary: { type: 'string' } },
  required: ['found', 'summary'],
}

const Reply = z.object({ found: z.boolean().default(false), summary: z.string().default('') })

/**
 * Step 5. Uses Gemini's search grounding, which returns both prose and the
 * source URLs it used — so the sources we cite are ones that exist. Grounding
 * cannot be combined with a response schema, so a second, cheap structuring
 * call turns the prose into a decision. Both calls are optional: if either
 * fails, the kit honestly records that nothing was found.
 */
export async function searchPublicDiscussion(input: {
  company: string
  role: string
  llm: LlmClient
}): Promise<PublicDiscussion> {
  const company = input.company.trim()
  if (company.length === 0) return EMPTY_PUBLIC_DISCUSSION

  try {
    const grounded = await input.llm.generateGrounded({
      system: 'You research publicly available descriptions of company interview processes and report only what sources say.',
      prompt: `What have candidates publicly written about the interview process at ${company}, particularly for a ${input.role || 'software engineering'} role? Report specifics: stages, formats, and what is assessed. If you find nothing specific to this company, say so plainly.`,
    })

    if (grounded.text.trim().length === 0) return EMPTY_PUBLIC_DISCUSSION

    const reply = await input.llm.generateJson(
      {
        system: SUMMARY_SYSTEM,
        prompt: `Company: ${company}\n\n${wrapUntrusted('SEARCH_RESULTS', grounded.text, 6000)}`,
        schema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
      (raw) => Reply.parse(raw),
    )

    const summary = reply.summary.trim()
    if (!reply.found || summary.length === 0) return EMPTY_PUBLIC_DISCUSSION

    return { found: true, summary, sources: grounded.sources }
  } catch {
    return EMPTY_PUBLIC_DISCUSSION
  }
}
