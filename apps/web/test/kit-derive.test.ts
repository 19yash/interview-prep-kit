import { describe, expect, it } from 'vitest'
import {
  CATEGORY_ORDER,
  coverageFor,
  groupByCategory,
  questionsForDay,
  requirementMap,
  sectionKeyForCategory,
  survivesRegeneration,
  totalMinutes,
} from '../lib/kit-derive.js'
import type { Kit, Question } from '../lib/types.js'

function question(id: string, category: Question['category'], requirement_ids: string[], origin: Question['origin'] = 'generated', pinned = false): Question {
  return { id, requirement_ids, category, prompt: `prompt ${id}`, answer_outline: '', difficulty: 2, origin, pinned, rev: 0 }
}

function kit(): Kit {
  return {
    source: {
      company: 'Acme',
      company_url: 'https://acme.test/',
      role: 'Engineer',
      location: 'Remote',
      jd_chars: 1000,
      researched_at: '2026-09-08T09:00:00Z',
      pages_used: ['https://acme.test/'],
    },
    company_brief: { summary: 's', what_they_do: 'w', sources: ['https://acme.test/'] },
    role: {
      title: 'Engineer',
      seniority: 'senior',
      responsibilities: ['Own routing'],
      requirements: [
        { id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring', kind: 'behavioural', priority: 'must' },
        { id: 'r3', text: 'Terraform', kind: 'technical', priority: 'nice' },
      ],
    },
    questions: [question('q1', 'technical', ['r1']), question('q2', 'behavioural', ['r2']), question('q3', 'technical', ['r1'])],
    flashcards: [],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Node.js', question_ids: ['q1', 'q3'], minutes: 90 },
        { day: 2, focus: 'Mentoring', question_ids: ['q2'], minutes: 60 },
      ],
    },
    coverage: { uncovered_requirement_ids: ['r3'], passes: 2 },
    warnings: [],
  }
}

describe('groupByCategory', () => {
  it('groups questions and keeps their order within a category', () => {
    const grouped = groupByCategory(kit().questions)
    expect(grouped.technical.map((q) => q.id)).toEqual(['q1', 'q3'])
    expect(grouped.behavioural.map((q) => q.id)).toEqual(['q2'])
  })

  it('returns an empty array for a category with no questions', () => {
    const grouped = groupByCategory(kit().questions)
    expect(grouped['system-design']).toEqual([])
    expect(grouped['company-fit']).toEqual([])
  })

  it('returns a key for every category in the canonical order', () => {
    expect(Object.keys(groupByCategory([]))).toEqual([...CATEGORY_ORDER])
  })
})

describe('requirementMap', () => {
  it('looks a requirement up by id', () => {
    expect(requirementMap(kit()).get('r2')?.text).toBe('Mentoring')
  })
})

describe('coverageFor', () => {
  it('resolves uncovered ids to requirements', () => {
    expect(coverageFor(kit()).uncovered.map((r) => r.id)).toEqual(['r3'])
  })

  it('separates uncovered must-haves, which are the ones that matter', () => {
    const withMustGap = kit()
    withMustGap.coverage.uncovered_requirement_ids = ['r2', 'r3']
    const result = coverageFor(withMustGap)
    expect(result.uncoveredMust.map((r) => r.id)).toEqual(['r2'])
  })

  it('counts covered against the total', () => {
    const result = coverageFor(kit())
    expect(result.total).toBe(3)
    expect(result.coveredCount).toBe(2)
  })

  it('ignores an uncovered id that no longer exists', () => {
    const stale = kit()
    stale.coverage.uncovered_requirement_ids = ['r99']
    expect(coverageFor(stale).uncovered).toEqual([])
  })
})

describe('questionsForDay', () => {
  it('resolves a day’s question ids to questions in schedule order', () => {
    expect(questionsForDay(kit(), 1).map((q) => q.id)).toEqual(['q1', 'q3'])
  })

  it('returns an empty array for a day that does not exist', () => {
    expect(questionsForDay(kit(), 9)).toEqual([])
  })

  it('skips an id with no matching question rather than returning a hole', () => {
    const broken = kit()
    broken.schedule.days[0]!.question_ids = ['q1', 'gone']
    expect(questionsForDay(broken, 1).map((q) => q.id)).toEqual(['q1'])
  })
})

describe('survivesRegeneration', () => {
  it('is false only for a generated, unpinned item', () => {
    expect(survivesRegeneration({ origin: 'generated', pinned: false })).toBe(false)
    expect(survivesRegeneration({ origin: 'generated', pinned: true })).toBe(true)
    expect(survivesRegeneration({ origin: 'edited', pinned: false })).toBe(true)
    expect(survivesRegeneration({ origin: 'manual', pinned: false })).toBe(true)
  })
})

describe('sectionKeyForCategory and totalMinutes', () => {
  it('builds the section key the api expects', () => {
    expect(sectionKeyForCategory('system-design')).toBe('questions_system-design')
  })

  it('sums the schedule minutes', () => {
    expect(totalMinutes(kit())).toBe(150)
  })
})
