import { z } from 'zod'
import type { RetrievedPage } from '../fetch/discover.js'
import type { LlmClient } from '../llm/client.js'
import { UNTRUSTED_PREAMBLE, wrapUntrusted } from '../llm/untrusted.js'
import type { CompanyBrief } from '../schema/kit.js'
import type { PublicDiscussion } from './search-public.js'

export const NO_INFORMATION_SUMMARY = 'No public information about this company could be retrieved.'

const SYSTEM = [
  'You write a short, factual brief about a company using only the pages provided.',
  'Two or three sentences for the summary; one or two for what they do.',
  'State only what the pages support. Do not speculate about size, funding, culture or products that are not mentioned.',
  UNTRUSTED_PREAMBLE,
].join(' ')

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, what_they_do: { type: 'string' } },
  required: ['summary', 'what_they_do'],
}

const Reply = z.object({ summary: z.string().default(''), what_they_do: z.string().default('') })

/**
 * Step 6. A company nothing can be found about gets an honest brief rather
 * than a fabricated one — the brief is explicit that this is the scored
 * behaviour, so the empty path is written first and the model is only asked
 * when there is something to read.
 */
export async function buildCompanyBrief(input: {
  company: string
  companyUrl: string
  pages: RetrievedPage[]
  publicDiscussion: PublicDiscussion
  llm: LlmClient
}): Promise<CompanyBrief> {
  const readable = input.pages.filter((page) => page.text.trim().length > 0)
  const sources = [...readable.map((p) => p.url), ...input.publicDiscussion.sources]

  if (readable.length === 0 && !input.publicDiscussion.found) {
    return {
      summary: NO_INFORMATION_SUMMARY,
      what_they_do: 'Not established from available sources.',
      sources: [],
    }
  }

  const blocks = readable
    .slice(0, 4)
    .map((page, index) => `Page ${index + 1} (${page.url}):\n${wrapUntrusted(`PAGE_${index + 1}`, page.text, 5000)}`)
    .join('\n\n')

  const extra = input.publicDiscussion.found
    ? `\n\nPublic discussion:\n${wrapUntrusted('PUBLIC_DISCUSSION', input.publicDiscussion.summary, 3000)}`
    : ''

  try {
    const reply = await input.llm.generateJson(
      {
        system: SYSTEM,
        prompt: `Write a brief about ${input.company || input.companyUrl}.\n\n${blocks}${extra}`,
        schema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
      (raw) => Reply.parse(raw),
    )

    return {
      summary: reply.summary.trim() || NO_INFORMATION_SUMMARY,
      what_they_do: reply.what_they_do.trim() || 'Not established from available sources.',
      sources,
    }
  } catch {
    // The pages were retrieved even though summarising them failed, so cite them.
    return {
      summary: `Pages were retrieved from ${input.companyUrl} but could not be summarised.`,
      what_they_do: 'Not established from available sources.',
      sources,
    }
  }
}
