import { describe, expect, it } from 'vitest'
import { validateKit } from '../src/schema/kit.js'

function validKit() {
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.test/',
      role: 'Senior Backend Engineer',
      location: 'Remote',
      jd_chars: 1200,
      researched_at: '2026-09-08T09:12:44Z',
      pages_used: ['https://acme.test/', 'https://acme.test/careers'],
    },
    company_brief: {
      summary: 'Acme builds logistics software.',
      what_they_do: 'Route optimisation for freight carriers.',
      sources: ['https://acme.test/'],
    },
    role: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      responsibilities: ['Own the routing service'],
      requirements: [
        { id: 'r1', text: '5+ years with Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring juniors', kind: 'behavioural', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Describe the Node.js event loop.',
        answer_outline: 'Phases, microtasks, starvation.',
        difficulty: 2,
      },
    ],
    flashcards: [{ id: 'f1', front: 'Event loop phases?', back: 'timers, pending, poll, check, close', requirement_ids: ['r1'] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Node internals', question_ids: ['q1'], minutes: 60 },
        { day: 2, focus: 'Review', question_ids: ['q1'], minutes: 30 },
      ],
    },
    coverage: { uncovered_requirement_ids: ['r2'], passes: 2 },
  }
}

describe('validateKit', () => {
  it('accepts a conforming kit', () => {
    const result = validateKit(validKit())
    expect(result.ok).toBe(true)
  })

  it('rejects a kit missing a top-level Appendix A section', () => {
    const kit = validKit() as Record<string, unknown>
    delete kit.coverage
    const result = validateKit(kit)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('coverage')
  })

  it('rejects non-integer minutes', () => {
    const kit = validKit()
    kit.schedule.days[0]!.minutes = 45.5
    expect(validateKit(kit).ok).toBe(false)
  })

  it('rejects difficulty outside 1..3', () => {
    const kit = validKit()
    kit.questions[0]!.difficulty = 4
    expect(validateKit(kit).ok).toBe(false)
  })

  it('rejects a question referencing a requirement that does not exist', () => {
    const kit = validKit()
    kit.questions[0]!.requirement_ids = ['r99']
    const result = validateKit(kit)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('r99')
  })

  it('rejects a schedule day referencing a question that does not exist', () => {
    const kit = validKit()
    kit.schedule.days[1]!.question_ids = ['q42']
    const result = validateKit(kit)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('q42')
  })

  it('rejects a day count that disagrees with days_available', () => {
    const kit = validKit()
    kit.schedule.days_available = 5
    expect(validateKit(kit).ok).toBe(false)
  })

  it('rejects malformed requirement ids', () => {
    const kit = validKit()
    kit.role.requirements[0]!.id = 'req-1'
    expect(validateKit(kit).ok).toBe(false)
  })
})
