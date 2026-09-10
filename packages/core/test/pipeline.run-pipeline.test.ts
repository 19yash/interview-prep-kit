import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createStubClient, type LlmClient } from '../src/llm/client.js'
import { runPipeline } from '../src/pipeline/run-pipeline.js'
import { clearRobotsCache } from '../src/fetch/robots.js'
import { validateKit } from '../src/schema/kit.js'

/**
 * A scripted client: it answers by inspecting the prompt, so one double serves
 * every step of a full run without the tests depending on call order.
 */
function scriptedLlm(overrides: { requirements?: unknown; questionsEmpty?: boolean } = {}): LlmClient {
  return createStubClient({
    grounded: { text: 'Candidates report a take-home and a design round.', sources: ['https://blog.test/acme'] },
    json: (call) => {
      const prompt = call.prompt
      if (prompt.includes('JOB_DESCRIPTION')) {
        return (
          overrides.requirements ?? {
            title: 'Senior Backend Engineer',
            seniority: 'senior',
            location: 'Remote',
            company_guess: 'Acme',
            responsibilities: ['Own routing'],
            requirements: [
              { text: '5+ years with Node.js', kind: 'technical', priority: 'must' },
              { text: 'Mentoring juniors', kind: 'behavioural', priority: 'must' },
            ],
          }
        )
      }
      if (prompt.includes('how this company interviews')) {
        return { found: true, stages: ['take-home', 'system design'], summary: 'Two rounds.' }
      }
      if (prompt.includes('SEARCH_RESULTS')) return { found: true, summary: 'A take-home then a design round.' }
      if (prompt.includes('Write a brief about')) return { summary: 'Acme does freight software.', what_they_do: 'Route optimisation.' }
      if (prompt.includes('Write flashcards')) {
        return { flashcards: [{ front: 'Event loop?', back: 'Phases.', requirement_ids: ['r1'] }] }
      }
      if (prompt.includes('Category:')) {
        if (overrides.questionsEmpty) return { questions: [] }
        if (prompt.includes('Category: all')) {
          return {
            questions: [
              { requirement_ids: ['r1'], category: 'technical', prompt: 'Explain the event loop.', answer_outline: 'outline', difficulty: 2 },
              { requirement_ids: ['r2'], category: 'behavioural', prompt: 'Tell me about mentoring someone.', answer_outline: 'outline', difficulty: 2 },
            ],
          }
        }
        const forBehavioural = prompt.includes('Category: behavioural')
        return {
          questions: [
            {
              requirement_ids: [forBehavioural ? 'r2' : 'r1'],
              category: forBehavioural ? 'behavioural' : 'technical',
              prompt: forBehavioural ? 'Tell me about mentoring someone.' : 'Explain the event loop.',
              answer_outline: 'outline',
              difficulty: 2,
            },
          ],
        }
      }
      return {}
    },
  })
}

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('User-agent: *\nAllow: /\n')
      return
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><nav><a href="careers/">Careers</a></nav><main><p>Acme routes freight.</p></main></body></html>')
      return
    }
    if (path === '/careers/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><head><title>Careers</title></head><body><main><p>We run a take-home then a system design round.</p></main></body></html>')
      return
    }
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end('missing')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  clearRobotsCache()
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const jd = 'Senior Backend Engineer. '.repeat(40)

describe('runPipeline', () => {
  it('produces a kit that passes structure validation', async () => {
    const result = await runPipeline({ jd, companyUrl: `${base}/`, days: 3, llm: scriptedLlm(), allowPrivate: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(validateKit(result.kit).ok).toBe(true)
  })

  it('records the pages it actually fetched, following a relative link', async () => {
    const result = await runPipeline({ jd, companyUrl: `${base}/`, days: 3, llm: scriptedLlm(), allowPrivate: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.kit.source.pages_used).toContain(`${base}/`)
    expect(result.kit.source.pages_used).toContain(`${base}/careers/`)
  })

  it('builds a schedule with exactly the days requested', async () => {
    for (const days of [1, 4, 60]) {
      const result = await runPipeline({ jd, companyUrl: `${base}/`, days, llm: scriptedLlm(), allowPrivate: true })
      if (!result.ok) throw new Error('expected ok')
      expect(result.kit.schedule.days).toHaveLength(days)
      expect(result.kit.schedule.days_available).toBe(days)
    }
  })

  it('runs a second pass and reports how many passes it ran', async () => {
    const result = await runPipeline({ jd, companyUrl: `${base}/`, days: 2, llm: scriptedLlm(), allowPrivate: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.kit.coverage.passes).toBeGreaterThanOrEqual(1)
    expect(result.kit.coverage.passes).toBeLessThanOrEqual(2)
  })

  it('closes a must-have gap on the second pass', async () => {
    // First pass answers only r1; the gap-filling pass names r2 directly.
    let sawGapCall = false
    const llm = createStubClient({
      grounded: { text: '', sources: [] },
      json: (call) => {
        if (call.prompt.includes('JOB_DESCRIPTION')) {
          return {
            title: 'Engineer',
            seniority: 'mid',
            location: '',
            company_guess: 'Acme',
            responsibilities: [],
            requirements: [
              { text: 'Node.js', kind: 'technical', priority: 'must' },
              { text: 'Mentoring', kind: 'behavioural', priority: 'must' },
            ],
          }
        }
        if (call.prompt.includes('Requirements with no question against them yet:')) {
          sawGapCall = true
          return { questions: [{ requirement_ids: ['r2'], prompt: 'Mentoring story?', answer_outline: '', difficulty: 2 }] }
        }
        if (call.prompt.includes('Category: all') || call.prompt.includes('Category: technical')) {
          return { questions: [{ requirement_ids: ['r1'], category: 'technical', prompt: 'Event loop?', answer_outline: '', difficulty: 2 }] }
        }
        if (call.prompt.includes('Category: behavioural')) {
          sawGapCall = true
          return { questions: [{ requirement_ids: ['r2'], prompt: 'Mentoring story?', answer_outline: '', difficulty: 2 }] }
        }
        if (call.prompt.includes('Category:')) return { questions: [] }
        if (call.prompt.includes('Write flashcards')) return { flashcards: [] }
        if (call.prompt.includes('Write a brief about')) return { summary: 's', what_they_do: 'w' }
        return {}
      },
    })
    const result = await runPipeline({ jd, companyUrl: `${base}/`, days: 2, llm, allowPrivate: true })
    if (!result.ok) throw new Error('expected ok')
    expect(sawGapCall).toBe(true)
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([])
  })

  it('ships an honest kit with the gap recorded when questions cannot be generated', async () => {
    const result = await runPipeline({
      jd,
      companyUrl: `${base}/`,
      days: 2,
      llm: scriptedLlm({ questionsEmpty: true }),
      allowPrivate: true,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.kit.questions).toEqual([])
    expect(result.kit.coverage.uncovered_requirement_ids.length).toBeGreaterThan(0)
    expect(validateKit(result.kit).ok).toBe(true)
  })

  it('still produces a kit when the company site is unreachable, with a warning', async () => {
    const result = await runPipeline({ jd, companyUrl: 'http://127.0.0.1:1/', days: 2, llm: scriptedLlm(), allowPrivate: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kit.warnings.length).toBeGreaterThan(0)
    expect(result.kit.source.pages_used).toEqual([])
    expect(result.kit.company_brief.summary.length).toBeGreaterThan(0)
  })

  it('produces a thin but valid kit from a two-line description', async () => {
    const llm = createStubClient({
      grounded: { text: '', sources: [] },
      json: (call) => {
        if (call.prompt.includes('JOB_DESCRIPTION')) {
          return {
            title: 'Backend dev',
            seniority: '',
            location: '',
            company_guess: '',
            responsibilities: [],
            requirements: [{ text: 'Node', kind: 'technical', priority: 'must' }],
          }
        }
        if (call.prompt.includes('Category: technical')) {
          return { questions: [{ requirement_ids: ['r1'], prompt: 'Node?', answer_outline: '', difficulty: 1 }] }
        }
        if (call.prompt.includes('Category:')) return { questions: [] }
        if (call.prompt.includes('Write flashcards')) return { flashcards: [] }
        if (call.prompt.includes('Write a brief about')) return { summary: 's', what_they_do: 'w' }
        return {}
      },
    })
    const result = await runPipeline({ jd: 'Backend dev.\nMust know Node.', companyUrl: `${base}/`, days: 2, llm, allowPrivate: true })
    if (!result.ok) throw new Error('expected ok')
    expect(result.kit.role.requirements).toHaveLength(1)
    expect(result.kit.warnings.some((w) => w.step === 'extractRequirements')).toBe(true)
    expect(validateKit(result.kit).ok).toBe(true)
  })

  it('fails with INVALID_INPUT for an empty job description', async () => {
    const result = await runPipeline({ jd: '   ', companyUrl: `${base}/`, days: 3, llm: scriptedLlm(), allowPrivate: true })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })

  it('fails with EXTRACTION_FAILED when extraction cannot run at all', async () => {
    const llm = createStubClient({ json: [], failJsonTimes: 1 })
    const result = await runPipeline({ jd, companyUrl: `${base}/`, days: 3, llm, allowPrivate: true })
    expect(result).toMatchObject({ ok: false, code: 'EXTRACTION_FAILED' })
  })

  it('reports progress for every step in order', async () => {
    const currents: string[] = []
    await runPipeline({
      jd,
      companyUrl: `${base}/`,
      days: 2,
      llm: scriptedLlm(),
      allowPrivate: true,
      onProgress: (progress) => {
        if (progress.current) currents.push(progress.current)
      },
    })
    expect(currents[0]).toBe('extractRequirements')
    expect(currents).toContain('discoverPages')
    expect(currents).toContain('generateQuestions')
    expect(currents).toContain('allocateSchedule')
    expect(currents.indexOf('discoverPages')).toBeLessThan(currents.indexOf('generateQuestions'))
    expect(currents.indexOf('checkCoverage')).toBeLessThan(currents.indexOf('allocateSchedule'))
  })
})
