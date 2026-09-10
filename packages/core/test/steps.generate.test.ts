import { describe, expect, it } from 'vitest'
import { checkCoverage } from '../src/coverage/check.js'
import { createStubClient } from '../src/llm/client.js'
import { fillGaps } from '../src/steps/fill-gaps.js'
import { generateFlashcards } from '../src/steps/generate-flashcards.js'
import { categoryForRequirement, createIdFactory, generateAllQuestions, generateQuestionsForCategory } from '../src/steps/generate-questions.js'
import { EMPTY_HIRING_SIGNALS } from '../src/steps/find-hiring-process.js'
import { EMPTY_PUBLIC_DISCUSSION } from '../src/steps/search-public.js'
import type { Requirement, Role } from '../src/schema/kit.js'

const requirements: Requirement[] = [
  { id: 'r1', text: '5+ years with React', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Freight logistics knowledge', kind: 'domain', priority: 'nice' },
]

const role: Role = { title: 'Senior Engineer', seniority: 'senior', responsibilities: [], requirements }

const base = {
  role,
  hiring: EMPTY_HIRING_SIGNALS,
  publicDiscussion: EMPTY_PUBLIC_DISCUSSION,
  existing: [],
}

describe('createIdFactory', () => {
  it('produces sequential ids from the given start', () => {
    const next = createIdFactory('q', 3)
    expect([next(), next(), next()]).toEqual(['q3', 'q4', 'q5'])
  })

  it('starts at one by default', () => {
    expect(createIdFactory('f')()).toBe('f1')
  })
})

describe('categoryForRequirement', () => {
  it('routes technical to technical, behavioural to behavioural, domain to company-fit', () => {
    expect(categoryForRequirement(requirements[0]!)).toBe('technical')
    expect(categoryForRequirement(requirements[1]!)).toBe('behavioural')
    expect(categoryForRequirement(requirements[2]!)).toBe('company-fit')
  })
})

describe('generateQuestionsForCategory', () => {
  it('assigns our ids, the requested category, and generated state', async () => {
    const llm = createStubClient({
      json: [{ questions: [{ requirement_ids: ['r1'], prompt: 'Explain reconciliation.', answer_outline: 'Diffing.', difficulty: 2 }] }],
    })
    const questions = await generateQuestionsForCategory({
      ...base,
      category: 'technical',
      requirements: [requirements[0]!],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ id: 'q1', category: 'technical', origin: 'generated', pinned: false, rev: 0 })
  })

  it('drops a question whose requirement_ids do not exist in the given requirements', async () => {
    const llm = createStubClient({
      json: [{ questions: [{ requirement_ids: ['r99'], prompt: 'x', answer_outline: '', difficulty: 2 }] }],
    })
    const questions = await generateQuestionsForCategory({
      ...base,
      category: 'technical',
      requirements: [requirements[0]!],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(questions).toEqual([])
  })

  it('clamps a difficulty outside 1..3 and rounds a float', async () => {
    const llm = createStubClient({
      json: [
        {
          questions: [
            { requirement_ids: ['r1'], prompt: 'a', answer_outline: '', difficulty: 9 },
            { requirement_ids: ['r1'], prompt: 'b', answer_outline: '', difficulty: 2.6 },
          ],
        },
      ],
    })
    const questions = await generateQuestionsForCategory({
      ...base,
      category: 'technical',
      requirements: [requirements[0]!],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(questions.map((q) => q.difficulty)).toEqual([3, 3])
  })

  it('drops a question with an empty prompt', async () => {
    const llm = createStubClient({ json: [{ questions: [{ requirement_ids: ['r1'], prompt: '  ', answer_outline: '', difficulty: 1 }] }] })
    const questions = await generateQuestionsForCategory({
      ...base,
      category: 'technical',
      requirements: [requirements[0]!],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(questions).toEqual([])
  })

  it('returns an empty list when the category has no requirements, without calling the model', async () => {
    let called = false
    const llm = {
      generateJson: async () => {
        called = true
        return {} as never
      },
      generateGrounded: async () => ({ text: '', sources: [] }),
    }
    const questions = await generateQuestionsForCategory({
      ...base,
      category: 'technical',
      requirements: [],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(questions).toEqual([])
    expect(called).toBe(false)
  })

  it('tells the model about the hiring stages it found', async () => {
    let seen = ''
    const llm = createStubClient({
      json: (call) => {
        seen = call.prompt
        return { questions: [] }
      },
    })
    await generateQuestionsForCategory({
      ...base,
      hiring: { found: true, stages: ['take-home', 'system design'], summary: 'Two rounds.', sources: [] },
      category: 'technical',
      requirements: [requirements[0]!],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(seen).toContain('take-home')
    expect(seen).toContain('system design')
  })

  it('tells the model which questions already exist so it does not duplicate them', async () => {
    let seen = ''
    const llm = createStubClient({
      json: (call) => {
        seen = call.prompt
        return { questions: [] }
      },
    })
    await generateQuestionsForCategory({
      ...base,
      existing: [
        { id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Existing question about hooks', answer_outline: '', difficulty: 2, origin: 'edited', pinned: false, rev: 1 },
      ],
      category: 'technical',
      requirements: [requirements[0]!],
      nextId: createIdFactory('q', 2),
      llm,
    })
    expect(seen).toContain('Existing question about hooks')
  })
})

describe('generateAllQuestions', () => {
  it('makes one call per populated category and never reuses an id', async () => {
    const seenCategories: string[] = []
    let counter = 0
    const llm = createStubClient({
      json: (call) => {
        const match = call.prompt.match(/Category: ([a-z-]+)/)
        seenCategories.push(match?.[1] ?? 'unknown')
        counter += 1
        return { questions: [{ requirement_ids: ['r1'], prompt: `q${counter}`, answer_outline: '', difficulty: 2 }] }
      },
    })
    const { questions } = await generateAllQuestions({ ...base, requirements, nextId: createIdFactory('q'), llm })
    // technical and behavioural/domain groups are called
    expect(new Set(seenCategories).size).toBe(2)
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length)
  })

  it('records a warning and keeps the other categories when one category fails', async () => {
    let n = 0
    const llm = createStubClient({
      json: () => {
        n += 1
        if (n === 1) throw new Error('category blew up')
        return { questions: [{ requirement_ids: ['r1'], prompt: 'ok', answer_outline: '', difficulty: 1 }] }
      },
    })
    const { questions, warnings } = await generateAllQuestions({ ...base, requirements, nextId: createIdFactory('q'), llm })
    expect(warnings.length).toBeGreaterThan(0)
    expect(questions.length).toBeGreaterThan(0)
  })

  it('produces nothing but no error when there are no requirements at all', async () => {
    const { questions, warnings } = await generateAllQuestions({
      ...base,
      requirements: [],
      nextId: createIdFactory('q'),
      llm: createStubClient({ json: [] }),
    })
    expect(questions).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('fillGaps', () => {
  it('generates a question for each uncovered requirement and closes the gap', async () => {
    const llm = createStubClient({
      json: [
        {
          questions: [
            { requirement_ids: ['r2'], prompt: 'Describe mentoring a junior.', answer_outline: '', difficulty: 2 },
            { requirement_ids: ['r3'], prompt: 'What do you know about freight?', answer_outline: '', difficulty: 1 },
          ],
        },
      ],
    })
    const existing = [
      { id: 'q1', requirement_ids: ['r1'], category: 'technical' as const, prompt: 'React', answer_outline: '', difficulty: 2, origin: 'generated' as const, pinned: false, rev: 0 },
    ]
    const before = checkCoverage(requirements, existing)
    expect(before.uncovered_requirement_ids).toEqual(['r2', 'r3'])

    const { questions } = await fillGaps({
      ...base,
      uncovered: requirements.filter((r) => before.uncovered_requirement_ids.includes(r.id)),
      existing,
      nextId: createIdFactory('q', 2),
      llm,
    })

    const after = checkCoverage(requirements, [...existing, ...questions])
    expect(after.uncovered_requirement_ids).toEqual([])
    expect(after.is_complete).toBe(true)
  })

  it('does nothing when there is no gap', async () => {
    let called = false
    const llm = {
      generateJson: async () => {
        called = true
        return {} as never
      },
      generateGrounded: async () => ({ text: '', sources: [] }),
    }
    const { questions } = await fillGaps({ ...base, uncovered: [], existing: [], nextId: createIdFactory('q'), llm })
    expect(questions).toEqual([])
    expect(called).toBe(false)
  })

  it('records a warning rather than throwing when the gap-filling call fails', async () => {
    const llm = createStubClient({ json: [], failJsonTimes: 1 })
    const { questions, warnings } = await fillGaps({
      ...base,
      uncovered: [requirements[1]!],
      existing: [],
      nextId: createIdFactory('q'),
      llm,
    })
    expect(questions).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

describe('generateFlashcards', () => {
  it('creates flashcards with our ids and generated state', async () => {
    const llm = createStubClient({
      json: [{ flashcards: [{ front: 'What is reconciliation?', back: 'Diffing the tree.', requirement_ids: ['r1'] }] }],
    })
    const { flashcards } = await generateFlashcards({ requirements, questions: [], nextId: createIdFactory('f'), llm })
    expect(flashcards[0]).toMatchObject({ id: 'f1', origin: 'generated', pinned: false })
  })

  it('drops a flashcard with an unknown requirement id or an empty front', async () => {
    const llm = createStubClient({
      json: [
        {
          flashcards: [
            { front: 'ok', back: 'b', requirement_ids: ['r1'] },
            { front: 'bad ref', back: 'b', requirement_ids: ['r99'] },
            { front: '   ', back: 'b', requirement_ids: ['r1'] },
          ],
        },
      ],
    })
    const { flashcards } = await generateFlashcards({ requirements, questions: [], nextId: createIdFactory('f'), llm })
    expect(flashcards).toHaveLength(1)
  })

  it('returns a warning instead of throwing when the call fails', async () => {
    const llm = createStubClient({ json: [], failJsonTimes: 1 })
    const { flashcards, warnings } = await generateFlashcards({ requirements, questions: [], nextId: createIdFactory('f'), llm })
    expect(flashcards).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('does not call the model when there are no requirements', async () => {
    let called = false
    const llm = {
      generateJson: async () => {
        called = true
        return {} as never
      },
      generateGrounded: async () => ({ text: '', sources: [] }),
    }
    const { flashcards } = await generateFlashcards({ requirements: [], questions: [], nextId: createIdFactory('f'), llm })
    expect(flashcards).toEqual([])
    expect(called).toBe(false)
  })
})
