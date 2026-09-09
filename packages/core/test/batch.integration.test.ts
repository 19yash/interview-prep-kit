import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearRobotsCache } from '../src/fetch/robots.js'
import { createStubClient, type LlmClient } from '../src/llm/client.js'
import { runBatch } from '../src/pipeline/run-batch.js'
import { BatchOutputSchema } from '../src/schema/batch.js'

function workingLlm(): LlmClient {
  return createStubClient({
    grounded: { text: '', sources: [] },
    json: (call) => {
      if (call.prompt.includes('JOB_DESCRIPTION')) {
        return {
          title: 'Engineer',
          seniority: 'mid',
          location: 'Remote',
          company_guess: 'Acme',
          responsibilities: ['Ship things'],
          requirements: [{ text: 'Node.js', kind: 'technical', priority: 'must' }],
        }
      }
      if (call.prompt.includes('Category: technical')) {
        return { questions: [{ requirement_ids: ['r1'], prompt: 'Event loop?', answer_outline: 'phases', difficulty: 2 }] }
      }
      if (call.prompt.includes('Category:')) return { questions: [] }
      if (call.prompt.includes('Write flashcards')) return { flashcards: [{ front: 'f', back: 'b', requirement_ids: ['r1'] }] }
      if (call.prompt.includes('Write a brief about')) return { summary: 's', what_they_do: 'w' }
      if (call.prompt.includes('how this company interviews')) return { found: false, stages: [], summary: '' }
      return {}
    },
  })
}

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body><main><p>Acme ships software.</p></main></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  clearRobotsCache()
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const jd = 'Senior Backend Engineer. '.repeat(40)

describe('runBatch', () => {
  it('writes one entry per input case, keyed by the given id', async () => {
    const output = await runBatch({
      cases: [
        { id: 'case-01', jd, company_url: `${base}/`, days: 3 },
        { id: 'case-02', jd, company_url: `${base}/`, days: 1 },
      ],
      llm: workingLlm(),
      allowPrivate: true,
    })
    expect(output.kits.map((k) => k.id).sort()).toEqual(['case-01', 'case-02'])
  })

  it('produces output that matches the Appendix B shape', async () => {
    const output = await runBatch({ cases: [{ id: 'c1', jd, company_url: `${base}/`, days: 2 }], llm: workingLlm(), allowPrivate: true })
    expect(() => BatchOutputSchema.parse(output)).not.toThrow()
    expect(output.version).toBe('1.0')
    expect(output.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('uses each case’s own day count when building its schedule', async () => {
    const output = await runBatch({
      cases: [
        { id: 'c1', jd, company_url: `${base}/`, days: 1 },
        { id: 'c2', jd, company_url: `${base}/`, days: 7 },
      ],
      llm: workingLlm(),
      allowPrivate: true,
    })
    const byId = new Map(output.kits.map((entry) => [entry.id, entry]))
    expect(byId.get('c1')!.kit!.schedule.days).toHaveLength(1)
    expect(byId.get('c2')!.kit!.schedule.days).toHaveLength(7)
  })

  it('marks a case ok with a null error when it succeeds', async () => {
    const output = await runBatch({ cases: [{ id: 'c1', jd, company_url: `${base}/`, days: 2 }], llm: workingLlm(), allowPrivate: true })
    expect(output.kits[0]).toMatchObject({ status: 'ok', error: null })
    expect(output.kits[0]!.kit).not.toBeNull()
  })

  it('keeps a case ok when the company site is unreachable, because partial research is not a failure', async () => {
    const output = await runBatch({ cases: [{ id: 'c1', jd, company_url: 'http://127.0.0.1:1/', days: 2 }], llm: workingLlm(), allowPrivate: true })
    expect(output.kits[0]!.status).toBe('ok')
    expect(output.kits[0]!.kit!.warnings.length).toBeGreaterThan(0)
  })

  it('records a failed case with a code and message, and keeps going', async () => {
    const output = await runBatch({
      cases: [
        { id: 'bad', jd: '   ', company_url: `${base}/`, days: 2 },
        { id: 'good', jd, company_url: `${base}/`, days: 2 },
      ],
      llm: workingLlm(),
      allowPrivate: true,
    })
    const byId = new Map(output.kits.map((entry) => [entry.id, entry]))
    expect(byId.get('bad')).toMatchObject({ status: 'failed', kit: null })
    expect(byId.get('bad')!.error!.code).toBe('INVALID_INPUT')
    expect(byId.get('good')!.status).toBe('ok')
  })

  it('records a failed case rather than throwing when the pipeline itself throws', async () => {
    const exploding: LlmClient = {
      generateJson: async () => {
        throw new Error('provider is on fire')
      },
      generateGrounded: async () => {
        throw new Error('provider is on fire')
      },
    }
    const output = await runBatch({ cases: [{ id: 'c1', jd, company_url: `${base}/`, days: 2 }], llm: exploding, allowPrivate: true })
    expect(output.kits[0]!.status).toBe('failed')
    expect(output.kits[0]!.error!.message.length).toBeGreaterThan(0)
  })

  it('reports each case as it completes', async () => {
    const seen: string[] = []
    await runBatch({
      cases: [
        { id: 'c1', jd, company_url: `${base}/`, days: 1 },
        { id: 'c2', jd, company_url: `${base}/`, days: 1 },
      ],
      llm: workingLlm(),
      allowPrivate: true,
      onCaseDone: (entry) => seen.push(entry.id),
    })
    expect(seen.sort()).toEqual(['c1', 'c2'])
  })

  it('handles an empty case list', async () => {
    const output = await runBatch({ cases: [], llm: workingLlm(), allowPrivate: true })
    expect(output.kits).toEqual([])
  })

  it('respects the concurrency limit', async () => {
    let active = 0
    let peak = 0
    const counting: LlmClient = {
      generateJson: async (call, parse) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return workingLlm().generateJson(call, parse)
      },
      generateGrounded: async () => ({ text: '', sources: [] }),
    }
    await runBatch({
      cases: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, jd, company_url: `${base}/`, days: 1 })),
      llm: counting,
      allowPrivate: true,
      concurrency: 2,
    })
    expect(peak).toBeLessThanOrEqual(2)
  })
})
