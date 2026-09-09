import { describe, expect, it } from 'vitest'
import { createStubClient, LlmError } from '../src/llm/client.js'
import { buildCompanyBrief } from '../src/steps/build-company-brief.js'
import { findHiringProcess } from '../src/steps/find-hiring-process.js'
import { EMPTY_PUBLIC_DISCUSSION, searchPublicDiscussion } from '../src/steps/search-public.js'
import type { RetrievedPage } from '../src/fetch/discover.js'

const hiringPage: RetrievedPage = {
  url: 'https://acme.test/careers/process',
  title: 'Our hiring process',
  text: 'We run a take-home exercise, then a system design interview, then a values conversation.',
  kind: 'hiring',
}

const aboutPage: RetrievedPage = {
  url: 'https://acme.test/',
  title: 'Acme',
  text: 'Acme builds route optimisation software for freight carriers.',
  kind: 'about',
}

describe('findHiringProcess', () => {
  it('returns the stages the pages describe and cites the pages it read', async () => {
    const llm = createStubClient({
      json: [{ found: true, stages: ['take-home', 'system design', 'values'], summary: 'Three stages.' }],
    })
    const signals = await findHiringProcess({ pages: [hiringPage, aboutPage], llm })
    expect(signals.found).toBe(true)
    expect(signals.stages).toEqual(['take-home', 'system design', 'values'])
    expect(signals.sources).toContain('https://acme.test/careers/process')
  })

  it('returns an honest empty result when no hiring page was retrieved', async () => {
    const llm = createStubClient({ json: [] })
    const signals = await findHiringProcess({ pages: [aboutPage], llm })
    expect(signals.found).toBe(false)
    expect(signals.stages).toEqual([])
  })

  it('returns an honest empty result when there are no pages at all', async () => {
    const signals = await findHiringProcess({ pages: [], llm: createStubClient({ json: [] }) })
    expect(signals.found).toBe(false)
  })

  it('degrades to empty rather than throwing when the model call fails', async () => {
    const llm = createStubClient({ json: [{ found: true, stages: [], summary: '' }], failJsonTimes: 1 })
    const signals = await findHiringProcess({ pages: [hiringPage], llm })
    expect(signals.found).toBe(false)
  })

  it('does not claim a process was found when the model returns no stages', async () => {
    const llm = createStubClient({ json: [{ found: true, stages: [], summary: 'nothing specific' }] })
    const signals = await findHiringProcess({ pages: [hiringPage], llm })
    expect(signals.found).toBe(false)
  })

  it('passes page text as untrusted content', async () => {
    let seen = ''
    const llm = createStubClient({
      json: (call) => {
        seen = call.prompt
        return { found: false, stages: [], summary: '' }
      },
    })
    await findHiringProcess({ pages: [hiringPage], llm })
    expect(seen).toContain('<<<BEGIN UNTRUSTED')
  })
})

describe('searchPublicDiscussion', () => {
  it('summarises a grounded result and keeps its sources', async () => {
    const llm = createStubClient({
      grounded: { text: 'Candidates report a take-home and a design round.', sources: ['https://blog.test/a'] },
      json: [{ found: true, summary: 'Candidates report a take-home and a design round.' }],
    })
    const result = await searchPublicDiscussion({ company: 'Acme', role: 'Backend Engineer', llm })
    expect(result.found).toBe(true)
    expect(result.sources).toEqual(['https://blog.test/a'])
  })

  it('reports nothing found when grounding returns nothing, without inventing sources', async () => {
    const llm = createStubClient({ grounded: { text: '', sources: [] }, json: [] })
    const result = await searchPublicDiscussion({ company: 'Acme', role: 'Backend Engineer', llm })
    expect(result).toEqual(EMPTY_PUBLIC_DISCUSSION)
  })

  it('degrades to empty when the provider fails entirely', async () => {
    const failing = {
      generateJson: async () => {
        throw new LlmError('PROVIDER', 'down', 1)
      },
      generateGrounded: async () => {
        throw new LlmError('PROVIDER', 'down', 1)
      },
    }
    const result = await searchPublicDiscussion({ company: 'Acme', role: 'x', llm: failing })
    expect(result.found).toBe(false)
  })

  it('skips the search when there is no company name to search for', async () => {
    let called = false
    const llm = {
      generateJson: async () => {
        called = true
        return {} as never
      },
      generateGrounded: async () => {
        called = true
        return { text: '', sources: [] }
      },
    }
    const result = await searchPublicDiscussion({ company: '   ', role: 'x', llm })
    expect(called).toBe(false)
    expect(result.found).toBe(false)
  })
})

describe('buildCompanyBrief', () => {
  it('builds a brief from the retrieved pages and lists them as sources', async () => {
    const llm = createStubClient({
      json: [{ summary: 'Acme is a freight software company.', what_they_do: 'Route optimisation.' }],
    })
    const brief = await buildCompanyBrief({
      company: 'Acme',
      companyUrl: 'https://acme.test/',
      pages: [aboutPage, hiringPage],
      publicDiscussion: EMPTY_PUBLIC_DISCUSSION,
      llm,
    })
    expect(brief.summary).toContain('Acme')
    expect(brief.sources).toEqual(['https://acme.test/', 'https://acme.test/careers/process'])
  })

  it('returns an honest brief with no sources when nothing was retrieved', async () => {
    const brief = await buildCompanyBrief({
      company: 'Acme',
      companyUrl: 'https://acme.test/',
      pages: [],
      publicDiscussion: EMPTY_PUBLIC_DISCUSSION,
      llm: createStubClient({ json: [] }),
    })
    expect(brief.sources).toEqual([])
    expect(brief.summary.toLowerCase()).toContain('no public information')
    expect(brief.what_they_do.toLowerCase()).toContain('not')
  })

  it('includes public discussion sources when there were any', async () => {
    const llm = createStubClient({ json: [{ summary: 's', what_they_do: 'w' }] })
    const brief = await buildCompanyBrief({
      company: 'Acme',
      companyUrl: 'https://acme.test/',
      pages: [aboutPage],
      publicDiscussion: { found: true, summary: 'reports of a take-home', sources: ['https://blog.test/a'] },
      llm,
    })
    expect(brief.sources).toContain('https://blog.test/a')
  })

  it('falls back to an honest brief rather than throwing when the model fails', async () => {
    const llm = createStubClient({ json: [{ summary: 's', what_they_do: 'w' }], failJsonTimes: 1 })
    const brief = await buildCompanyBrief({
      company: 'Acme',
      companyUrl: 'https://acme.test/',
      pages: [aboutPage],
      publicDiscussion: EMPTY_PUBLIC_DISCUSSION,
      llm,
    })
    expect(brief.summary.length).toBeGreaterThan(0)
    expect(brief.sources).toEqual(['https://acme.test/'])
  })
})
