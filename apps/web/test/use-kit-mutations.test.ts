import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KitDoc, Question } from '../lib/types.js'

function question(id: string, origin: Question['origin'] = 'generated'): Question {
  return {
    id,
    requirement_ids: ['r1'],
    category: 'technical',
    prompt: `prompt ${id}`,
    answer_outline: '',
    difficulty: 2,
    origin,
    pinned: false,
    rev: 0,
  }
}

function doc(): KitDoc {
  return {
    id: 'k1',
    status: 'ready',
    input: { jd: 'x', companyUrl: 'https://a.test/', days: 2 },
    progress: { steps: [], current: null },
    kit: {
      source: {
        company: 'Acme',
        company_url: 'https://a.test/',
        role: 'Engineer',
        location: '',
        jd_chars: 900,
        researched_at: '2026-09-08T09:00:00Z',
        pages_used: [],
      },
      company_brief: { summary: 'old summary', what_they_do: 'w', sources: [] },
      role: {
        title: 'Engineer',
        seniority: 'senior',
        responsibilities: [],
        requirements: [{ id: 'r1', text: 'Node.js', kind: 'technical', priority: 'must' }],
      },
      questions: [question('q1'), question('q2')],
      flashcards: [],
      schedule: { days_available: 2, days: [{ day: 1, focus: 'f', question_ids: ['q1'], minutes: 60 }, { day: 2, focus: 'f', question_ids: ['q2'], minutes: 60 }] },
      coverage: { uncovered_requirement_ids: [], passes: 1 },
      warnings: [],
    },
    sections: {},
    practice: [],
    error: null,
    createdAt: '2026-09-08T09:00:00Z',
    updatedAt: '2026-09-08T09:00:00Z',
  }
}

/**
 * The api module is replaced per test so the hook can be exercised without a
 * server. Each test imports the hook after the mock is registered.
 */
async function load(apiMock: Record<string, unknown>) {
  vi.resetModules()
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message)
    }
  }
  vi.doMock('../lib/api.js', () => ({ api: apiMock, ApiError }))
  const module = await import('../lib/use-kit-mutations.js')
  return { useKitMutations: module.useKitMutations, ApiError }
}

function harness(useKitMutations: (args: never) => unknown, initial: KitDoc) {
  let current = initial
  const setDoc = vi.fn((next: KitDoc) => {
    current = next
  })
  const refresh = vi.fn(async () => {})
  const rendered = renderHook(() => useKitMutations({ doc: current, setDoc, refresh } as never))
  return { rendered, setDoc, refresh, read: () => current }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('editQuestion', () => {
  it('applies the change locally before the request resolves', async () => {
    let release: (value: KitDoc) => void = () => {}
    const pending = new Promise<KitDoc>((resolve) => {
      release = resolve
    })
    const { useKitMutations } = await load({ patchQuestion: vi.fn(() => pending) })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    void act(() => {
      void (rendered.result.current as { editQuestion: (id: string, patch: object) => Promise<void> }).editQuestion('q1', {
        prompt: 'my wording',
      })
    })

    await waitFor(() => expect(setDoc).toHaveBeenCalled())
    const optimistic = setDoc.mock.calls[0]![0]
    expect(optimistic.kit!.questions.find((q) => q.id === 'q1')!.prompt).toBe('my wording')
    // An edit is an act of ownership, so the interface marks it at once.
    expect(optimistic.kit!.questions.find((q) => q.id === 'q1')!.origin).toBe('edited')

    await act(async () => {
      release(doc())
    })
  })

  it('replaces the local document with the one the api returns', async () => {
    const returned = doc()
    returned.kit!.coverage.uncovered_requirement_ids = ['r1']
    const { useKitMutations } = await load({ patchQuestion: vi.fn(async () => returned) })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { editQuestion: (id: string, patch: object) => Promise<void> }).editQuestion('q1', { prompt: 'x' })
    })

    // Server-side effects — recomputed coverage here — must not be lost.
    expect(setDoc.mock.calls.at(-1)![0].kit!.coverage.uncovered_requirement_ids).toEqual(['r1'])
  })

  it('rolls back and reports the api message on failure', async () => {
    const { useKitMutations, ApiError } = await load({
      patchQuestion: vi.fn(async () => {
        throw new ApiError(422, 'INVALID_KIT', 'a question needs a prompt')
      }),
    })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { editQuestion: (id: string, patch: object) => Promise<void> }).editQuestion('q1', { prompt: 'x' })
    })

    expect(setDoc.mock.calls.at(-1)![0].kit!.questions.find((q) => q.id === 'q1')!.prompt).toBe('prompt q1')
    expect((rendered.result.current as { error: string | null }).error).toBe('a question needs a prompt')
  })

  it('marks only the affected item busy while in flight', async () => {
    let release: (value: KitDoc) => void = () => {}
    const pending = new Promise<KitDoc>((resolve) => {
      release = resolve
    })
    const { useKitMutations } = await load({ patchQuestion: vi.fn(() => pending) })
    const { rendered } = harness(useKitMutations as never, doc())

    void act(() => {
      void (rendered.result.current as never as { editQuestion: (id: string, patch: object) => Promise<void> }).editQuestion('q1', { prompt: 'x' })
    })

    await waitFor(() => expect((rendered.result.current as { busy: Set<string> }).busy.has('question:q1')).toBe(true))
    expect((rendered.result.current as { busy: Set<string> }).busy.has('question:q2')).toBe(false)

    await act(async () => {
      release(doc())
    })
    await waitFor(() => expect((rendered.result.current as { busy: Set<string> }).busy.size).toBe(0))
  })
})

describe('pinQuestion', () => {
  it('pins without changing the prompt or the origin', async () => {
    const { useKitMutations } = await load({ patchQuestion: vi.fn(async () => doc()) })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { pinQuestion: (id: string, pinned: boolean) => Promise<void> }).pinQuestion('q1', true)
    })

    const optimistic = setDoc.mock.calls[0]![0]
    const pinned = optimistic.kit!.questions.find((q) => q.id === 'q1')!
    expect(pinned.pinned).toBe(true)
    expect(pinned.origin).toBe('generated')
  })
})

describe('deleteQuestion', () => {
  it('removes the question locally and drops it from the schedule', async () => {
    const { useKitMutations } = await load({ deleteQuestion: vi.fn(async () => undefined), getKit: vi.fn(async () => doc()) })
    const { rendered, setDoc, refresh } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { deleteQuestion: (id: string) => Promise<void> }).deleteQuestion('q1')
    })

    const optimistic = setDoc.mock.calls[0]![0]
    expect(optimistic.kit!.questions.map((q) => q.id)).toEqual(['q2'])
    expect(optimistic.kit!.schedule.days.flatMap((d) => d.question_ids)).not.toContain('q1')
    // Delete returns no body, so the authoritative document is refetched.
    expect(refresh).toHaveBeenCalled()
  })

  it('restores the question when the delete fails', async () => {
    const { useKitMutations, ApiError } = await load({
      deleteQuestion: vi.fn(async () => {
        throw new ApiError(404, 'NOT_FOUND', 'no such question')
      }),
    })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { deleteQuestion: (id: string) => Promise<void> }).deleteQuestion('q1')
    })

    expect(setDoc.mock.calls.at(-1)![0].kit!.questions.map((q) => q.id)).toEqual(['q1', 'q2'])
    expect((rendered.result.current as { error: string | null }).error).toBe('no such question')
  })
})

describe('reorderQuestions', () => {
  it('applies the new order locally and sends the full id list', async () => {
    const reorderQuestions = vi.fn(async () => doc())
    const { useKitMutations } = await load({ reorderQuestions })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { reorderQuestions: (ids: string[]) => Promise<void> }).reorderQuestions(['q2', 'q1'])
    })

    expect(setDoc.mock.calls[0]![0].kit!.questions.map((q) => q.id)).toEqual(['q2', 'q1'])
    expect(reorderQuestions).toHaveBeenCalledWith('k1', ['q2', 'q1'])
  })
})

describe('regenerate', () => {
  it('marks the section regenerating, then swaps in the returned kit', async () => {
    const returned = doc()
    returned.kit!.questions = [question('q9')]
    const { useKitMutations } = await load({ regenerate: vi.fn(async () => returned) })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { regenerate: (section: string) => Promise<void> }).regenerate('questions_technical')
    })

    expect(setDoc.mock.calls[0]![0].sections.questions_technical!.status).toBe('regenerating')
    expect(setDoc.mock.calls.at(-1)![0].kit!.questions.map((q) => q.id)).toEqual(['q9'])
  })

  it('leaves the previous content in place and reports the failure', async () => {
    const { useKitMutations, ApiError } = await load({
      regenerate: vi.fn(async () => {
        throw new ApiError(502, 'REGENERATION_FAILED', 'the model is unavailable')
      }),
    })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { regenerate: (section: string) => Promise<void> }).regenerate('questions_technical')
    })

    const final = setDoc.mock.calls.at(-1)![0]
    expect(final.kit!.questions.map((q) => q.id)).toEqual(['q1', 'q2'])
    expect((rendered.result.current as { error: string | null }).error).toBe('the model is unavailable')
  })
})

describe('editBrief', () => {
  it('edits the brief locally and reconciles', async () => {
    const { useKitMutations } = await load({ patchBrief: vi.fn(async () => doc()) })
    const { rendered, setDoc } = harness(useKitMutations as never, doc())

    await act(async () => {
      await (rendered.result.current as never as { editBrief: (patch: object) => Promise<void> }).editBrief({ summary: 'mine' })
    })

    expect(setDoc.mock.calls[0]![0].kit!.company_brief.summary).toBe('mine')
  })
})
