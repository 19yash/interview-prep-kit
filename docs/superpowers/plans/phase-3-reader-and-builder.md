# Phase 3 — Reader and Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the generated kit from something you read into something you reshape: read the brief, role, question bank, flashcards and schedule; edit any of it inline; reorder questions and move them between categories; add and delete by hand; and regenerate one section without losing work done anywhere else.

**Architecture:** One mutation layer owns every write. Each mutation applies to local state immediately, sends a single request for that one item, and reconciles with the document the API returns — so nothing round-trips per keystroke and a failure rolls back with a message. Reader components are presentational and take an `editable` flag, so the reader and the builder are the same components rather than two implementations that drift.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind. Reordering uses native HTML5 drag events plus keyboard move controls — no drag-and-drop library.

**Spec:** `docs/superpowers/specs/2026-09-08-interview-prep-kit-design.md`

**Depends on:** Phase 1 Task 14 (the builder endpoints and the origin/pinned rules) and all of Phase 2 (API client, `useKit`, UI primitives).

## Global Constraints

- TypeScript only, `strict: true`.
- **Editing never round-trips per keystroke.** Local state while typing; one request on commit (blur, or ⌘/Ctrl+Enter).
- **Every mutation is optimistic with rollback.** Apply locally, request, reconcile on success, restore the previous document and show the API's message on failure.
- **Regeneration must not clobber work.** The server enforces it (Phase 1 Task 14); the interface must also *show* it — an item that will survive a regeneration is visibly marked before the user presses the button.
- Reordering must be operable by keyboard alone. Drag is an addition, never the only route.
- No `window.confirm`. Destructive actions use an inline two-step confirm, as `KitListItem` already does.
- Every editable field is a labelled control with a visible focus ring.
- Never render an error object — show `ApiError.message`.
- A section that is regenerating stays readable; only that section shows a busy state.

## File Structure

```
apps/web/
  lib/
    use-kit-mutations.ts       every write, optimistic, in one place
    kit-derive.ts              read-only selectors over a Kit
  components/
    kit/
      OriginBadge.tsx          generated / edited / yours / pinned
      EditableText.tsx         click-to-edit text and textarea
      BriefSection.tsx
      RoleSection.tsx
      QuestionCard.tsx
      QuestionList.tsx         one category, with reorder and add
      QuestionBank.tsx         all four categories
      FlashcardList.tsx
      ScheduleView.tsx
      CoverageNotice.tsx
      RegenerateButton.tsx
      SectionTabs.tsx
  app/
    kits/[id]/page.tsx         replaces the Phase 2 summary branch
  test/
    kit-derive.test.ts
    use-kit-mutations.test.ts
    reorder.test.ts
```

---

## Task 1: Read-only selectors over a kit

Small pure functions, so the components stay about presentation and the
grouping and counting logic is tested once.

**Files:**
- Create: `apps/web/lib/kit-derive.ts`
- Test: `apps/web/test/kit-derive.test.ts`

**Interfaces:**
- Consumes: `Kit`, `Question`, `Flashcard`, `Requirement`, `QuestionCategory` from `@/lib/types`.
- Produces:
  - `CATEGORY_ORDER: readonly QuestionCategory[]` — `['technical', 'behavioural', 'system-design', 'company-fit']`
  - `CATEGORY_LABELS: Record<QuestionCategory, string>`
  - `groupByCategory(questions: Question[]): Record<QuestionCategory, Question[]>`
  - `requirementMap(kit: Kit): Map<string, Requirement>`
  - `coverageFor(kit: Kit): { uncovered: Requirement[]; uncoveredMust: Requirement[]; coveredCount: number; total: number }`
  - `questionsForDay(kit: Kit, day: number): Question[]`
  - `survivesRegeneration(item: { origin: Origin; pinned: boolean }): boolean`
  - `sectionKeyForCategory(category: QuestionCategory): string`
  - `totalMinutes(kit: Kit): number`

`survivesRegeneration` is the same predicate the server uses, duplicated
deliberately so the interface can mark an item before the request is made. The
duplication is one boolean expression and it is noted in the README.

- [ ] **Step 1: Write the failing test**

`apps/web/test/kit-derive.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/kit-derive.test.ts`
Expected: FAIL — cannot resolve `../lib/kit-derive.js`.

- [ ] **Step 3: Write the selectors**

`apps/web/lib/kit-derive.ts`:

```ts
import type { Kit, Origin, Question, QuestionCategory, Requirement } from './types'

export const CATEGORY_ORDER = ['technical', 'behavioural', 'system-design', 'company-fit'] as const

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
}

export function groupByCategory(questions: Question[]): Record<QuestionCategory, Question[]> {
  const grouped = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, [] as Question[]])) as Record<
    QuestionCategory,
    Question[]
  >
  for (const question of questions) grouped[question.category]?.push(question)
  return grouped
}

export function requirementMap(kit: Kit): Map<string, Requirement> {
  return new Map(kit.role.requirements.map((requirement) => [requirement.id, requirement]))
}

export function coverageFor(kit: Kit) {
  const byId = requirementMap(kit)
  const uncovered = kit.coverage.uncovered_requirement_ids
    .map((id) => byId.get(id))
    .filter((requirement): requirement is Requirement => requirement !== undefined)

  return {
    uncovered,
    // Only an uncovered must-have is a failure; an uncovered nice-to-have is
    // information, which is why the two are reported separately.
    uncoveredMust: uncovered.filter((requirement) => requirement.priority === 'must'),
    coveredCount: kit.role.requirements.length - uncovered.length,
    total: kit.role.requirements.length,
  }
}

export function questionsForDay(kit: Kit, day: number): Question[] {
  const target = kit.schedule.days.find((entry) => entry.day === day)
  if (!target) return []
  const byId = new Map(kit.questions.map((question) => [question.id, question]))
  return target.question_ids
    .map((id) => byId.get(id))
    .filter((question): question is Question => question !== undefined)
}

/**
 * The same predicate the server applies when regenerating. Duplicated here on
 * purpose: the interface must be able to tell the user what will survive
 * *before* they press the button, and asking the server that would mean an
 * extra endpoint for one boolean.
 */
export function survivesRegeneration(item: { origin: Origin; pinned: boolean }): boolean {
  return item.origin !== 'generated' || item.pinned
}

export function sectionKeyForCategory(category: QuestionCategory): string {
  return `questions_${category}`
}

export function totalMinutes(kit: Kit): number {
  return kit.schedule.days.reduce((sum, day) => sum + day.minutes, 0)
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/kit-derive.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit** — *present this message to the user; do not run it*

```
feat(web): add pure selectors for grouping, coverage and schedule lookup
```

---

## Task 2: The optimistic mutation layer

Every write in the builder goes through one hook, so the optimistic-apply,
reconcile and rollback behaviour exists once and is tested once.

**Files:**
- Create: `apps/web/lib/use-kit-mutations.ts`
- Create: `apps/web/lib/reorder.ts`
- Test: `apps/web/test/use-kit-mutations.test.ts`
- Test: `apps/web/test/reorder.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError`, `KitDoc`, `Kit`, `Question`, `Flashcard`, `QuestionCategory`.
- Produces:
  - `move<T>(items: T[], from: number, to: number): T[]` — pure, clamped
  - `useKitMutations(args: { doc: KitDoc; setDoc: (doc: KitDoc) => void; refresh: () => Promise<void> }): Mutations`
  - `type Mutations = { busy: Set<string>; error: string | null; clearError: () => void; editQuestion; pinQuestion; addQuestion; deleteQuestion; moveQuestionToCategory; reorderQuestions; editFlashcard; pinFlashcard; addFlashcard; deleteFlashcard; editBrief; regenerate }`
  - `type MutationKey = string` — `busy` holds keys like `question:q3`, `section:questions_technical`, `brief`

Rules the tests pin down:

- The local document changes before the request is sent.
- The document the API returns replaces the local one on success, so server-side
  effects — a recomputed coverage set, a pruned schedule — are never missed.
- On failure the previous document is restored and `error` holds the API's
  sentence.
- A mutation in flight records a key in `busy`, so exactly the affected control
  can show a busy state instead of the whole page freezing.

- [ ] **Step 1: Write the failing reorder test**

`apps/web/test/reorder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { move } from '../lib/reorder.js'

describe('move', () => {
  it('moves an item later', () => {
    expect(move(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves an item earlier', () => {
    expect(move(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns an equal array when the indices match', () => {
    expect(move(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })

  it('clamps a target past the end', () => {
    expect(move(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a'])
  })

  it('clamps a negative target', () => {
    expect(move(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
  })

  it('returns the same contents for an out-of-range source', () => {
    expect(move(['a', 'b'], 9, 0)).toEqual(['a', 'b'])
  })

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c']
    move(input, 0, 2)
    expect(input).toEqual(['a', 'b', 'c'])
  })

  it('handles empty and single-item arrays', () => {
    expect(move([], 0, 1)).toEqual([])
    expect(move(['a'], 0, 0)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails, then write `reorder.ts`**

Run: `npx vitest run apps/web/test/reorder.test.ts` — expected FAIL.

`apps/web/lib/reorder.ts`:

```ts
/** Pure list reorder, clamped, non-mutating. Shared by drag and keyboard. */
export function move<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item === undefined) return next
  const target = Math.min(Math.max(to, 0), next.length)
  next.splice(target, 0, item)
  return next
}
```

Run it again — expected PASS, 8 tests.

- [ ] **Step 3: Write the failing mutations test**

`apps/web/test/use-kit-mutations.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/use-kit-mutations.test.ts`
Expected: FAIL — cannot resolve `../lib/use-kit-mutations.js`.

- [ ] **Step 5: Write the hook**

`apps/web/lib/use-kit-mutations.ts`:

```ts
'use client'

import { useCallback, useMemo, useState } from 'react'
import { api, ApiError } from './api'
import type { Flashcard, Kit, KitDoc, Question, QuestionCategory } from './types'

type Patch<T> = Partial<T>

function withKit(doc: KitDoc, mutate: (kit: Kit) => void): KitDoc {
  if (!doc.kit) return doc
  const next = structuredClone(doc) as KitDoc
  mutate(next.kit!)
  return next
}

/**
 * Every write in the builder. The pattern is the same throughout: apply the
 * change to a clone at once so typing and dragging feel local, send one request
 * for that one item, then replace the document with the one the server
 * returns — which carries effects the client should not try to recompute, such
 * as a recalculated coverage set or a schedule with a deleted question pruned
 * out of it. A failure restores the document exactly as it was and surfaces the
 * server's own sentence.
 */
export function useKitMutations({
  doc,
  setDoc,
  refresh,
}: {
  doc: KitDoc
  setDoc: (doc: KitDoc) => void
  refresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const mark = useCallback((key: string, on: boolean) => {
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /** The shared envelope: optimistic apply, request, reconcile or roll back. */
  const run = useCallback(
    async (key: string, optimistic: KitDoc, request: () => Promise<KitDoc | void>, refetch = false) => {
      const previous = doc
      setError(null)
      mark(key, true)
      setDoc(optimistic)
      try {
        const returned = await request()
        if (returned) setDoc(returned)
        else if (refetch) await refresh()
      } catch (caught) {
        setDoc(previous)
        setError(caught instanceof ApiError ? caught.message : 'that change could not be saved')
      } finally {
        mark(key, false)
      }
    },
    [doc, setDoc, refresh, mark],
  )

  return useMemo(() => {
    const kitId = doc.id

    return {
      busy,
      error,
      clearError: () => setError(null),

      editQuestion: (id: string, patch: Patch<Pick<Question, 'prompt' | 'answer_outline' | 'difficulty'>>) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            const question = kit.questions.find((item) => item.id === id)
            if (!question) return
            Object.assign(question, patch)
            // Mirrors the server rule: an edit takes the item out of reach of
            // any future regeneration of its category.
            question.origin = question.origin === 'manual' ? 'manual' : 'edited'
            question.rev += 1
          }),
          () => api.patchQuestion(kitId, id, patch),
        ),

      pinQuestion: (id: string, pinned: boolean) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            const question = kit.questions.find((item) => item.id === id)
            if (question) question.pinned = pinned
          }),
          () => api.patchQuestion(kitId, id, { pinned }),
        ),

      addQuestion: async (input: {
        category: QuestionCategory
        prompt: string
        answer_outline?: string
        requirement_ids?: string[]
        difficulty?: number
      }) => {
        // No optimistic id: the server assigns it, and inventing one locally
        // would risk colliding with an id it later hands out.
        setError(null)
        mark(`add:${input.category}`, true)
        try {
          const { kit } = await api.addQuestion(kitId, input)
          setDoc(kit)
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : 'that question could not be added')
        } finally {
          mark(`add:${input.category}`, false)
        }
      },

      deleteQuestion: (id: string) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            kit.questions = kit.questions.filter((item) => item.id !== id)
            kit.schedule.days = kit.schedule.days.map((day) => ({
              ...day,
              question_ids: day.question_ids.filter((qid) => qid !== id),
            }))
          }),
          () => api.deleteQuestion(kitId, id),
          true,
        ),

      moveQuestionToCategory: (id: string, category: QuestionCategory) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            const question = kit.questions.find((item) => item.id === id)
            if (!question) return
            question.category = category
            if (question.origin === 'generated') question.origin = 'edited'
            question.rev += 1
          }),
          () => api.moveQuestion(kitId, id, category),
        ),

      reorderQuestions: (ids: string[]) =>
        run(
          'order:questions',
          withKit(doc, (kit) => {
            const byId = new Map(kit.questions.map((question) => [question.id, question]))
            kit.questions = ids
              .map((id) => byId.get(id))
              .filter((question): question is Question => question !== undefined)
          }),
          () => api.reorderQuestions(kitId, ids),
        ),

      editFlashcard: (id: string, patch: Patch<Pick<Flashcard, 'front' | 'back'>>) =>
        run(
          `flashcard:${id}`,
          withKit(doc, (kit) => {
            const card = kit.flashcards.find((item) => item.id === id)
            if (!card) return
            Object.assign(card, patch)
            card.origin = card.origin === 'manual' ? 'manual' : 'edited'
            card.rev += 1
          }),
          () => api.patchFlashcard(kitId, id, patch),
        ),

      pinFlashcard: (id: string, pinned: boolean) =>
        run(
          `flashcard:${id}`,
          withKit(doc, (kit) => {
            const card = kit.flashcards.find((item) => item.id === id)
            if (card) card.pinned = pinned
          }),
          () => api.patchFlashcard(kitId, id, { pinned }),
        ),

      addFlashcard: async (input: { front: string; back?: string; requirement_ids?: string[] }) => {
        setError(null)
        mark('add:flashcard', true)
        try {
          const { kit } = await api.addFlashcard(kitId, input)
          setDoc(kit)
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : 'that flashcard could not be added')
        } finally {
          mark('add:flashcard', false)
        }
      },

      deleteFlashcard: (id: string) =>
        run(
          `flashcard:${id}`,
          withKit(doc, (kit) => {
            kit.flashcards = kit.flashcards.filter((item) => item.id !== id)
          }),
          () => api.deleteFlashcard(kitId, id),
          true,
        ),

      editBrief: (patch: { summary?: string; what_they_do?: string }) =>
        run(
          'brief',
          withKit(doc, (kit) => {
            Object.assign(kit.company_brief, patch)
          }),
          () => api.patchBrief(kitId, patch),
        ),

      regenerate: (section: string) => {
        // The kit itself is untouched optimistically: the point of a
        // regeneration is that the old content stays readable until the new
        // content has arrived and validated.
        const optimistic: KitDoc = {
          ...doc,
          sections: {
            ...doc.sections,
            [section]: { status: 'regenerating', rev: doc.sections[section]?.rev ?? 0, error: null },
          },
        }
        return run(`section:${section}`, optimistic, () => api.regenerate(kitId, section))
      },
    }
  }, [doc, busy, error, run, mark, setDoc])
}

export type Mutations = ReturnType<typeof useKitMutations>
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/use-kit-mutations.test.ts`
Expected: PASS.

If the `vi.doMock` plus dynamic-import pattern proves brittle, change
`useKitMutations` to accept an optional `client` argument defaulting to `api`
and inject a plain object in the tests. That is the simpler design; take it and
update the interface block if the mock fights you.

- [ ] **Step 7: Commit** — *present this message to the user; do not run it*

```
feat(web): add optimistic kit mutation layer with rollback
```

---

## Task 3: Editable primitives and the origin badge

The badge is not decoration. It is how the user knows, before pressing
Regenerate, which of their work is safe.

**Files:**
- Create: `apps/web/components/kit/OriginBadge.tsx`
- Create: `apps/web/components/kit/EditableText.tsx`

**Interfaces:**
- Consumes: `survivesRegeneration`, `Button`.
- Produces:
  - `OriginBadge` — props `{ origin: Origin; pinned: boolean }`
  - `EditableText` — props `{ value: string; onCommit: (next: string) => void; label: string; multiline?: boolean; placeholder?: string; busy?: boolean; className?: string; required?: boolean }`

`EditableText` behaviour: click or focus to edit, ⌘/Ctrl+Enter or blur commits,
Escape reverts, an unchanged value sends nothing, and an empty value is refused
locally when `required`. This is where "editing does not round-trip for every
keystroke" is actually satisfied.

- [ ] **Step 1: Write the origin badge**

`apps/web/components/kit/OriginBadge.tsx`:

```tsx
import type { Origin } from '@/lib/types'
import { survivesRegeneration } from '@/lib/kit-derive'

const LABELS: Record<Origin, { text: string; className: string; title: string }> = {
  generated: { text: 'Generated', className: 'bg-slate-100 text-slate-600', title: 'Written by the model. A regeneration of this section will replace it.' },
  edited: { text: 'Edited', className: 'bg-indigo-50 text-indigo-800', title: 'You changed this, so a regeneration will keep it.' },
  manual: { text: 'Yours', className: 'bg-emerald-50 text-emerald-800', title: 'You wrote this, so a regeneration will keep it.' },
}

/**
 * The state model made visible. Someone about to regenerate a section can see
 * at a glance which items will be replaced and which are theirs — which is the
 * difference between a builder people trust and one they are afraid of.
 */
export function OriginBadge({ origin, pinned }: { origin: Origin; pinned: boolean }) {
  const label = LABELS[origin]
  const safe = survivesRegeneration({ origin, pinned })

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${label.className}`} title={label.title}>
        {label.text}
      </span>
      {pinned && (
        <span
          className="inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
          title="Pinned, so a regeneration will keep it."
        >
          Pinned
        </span>
      )}
      <span className="sr-only">{safe ? 'This will survive a regeneration.' : 'A regeneration will replace this.'}</span>
    </span>
  )
}
```

- [ ] **Step 2: Write the editable field**

`apps/web/components/kit/EditableText.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Local while typing, one request on commit. Nothing is sent per keystroke,
 * and nothing is sent at all if the value has not changed — which keeps a
 * stray focus-and-blur from bumping an item's revision and quietly marking it
 * as edited.
 */
export function EditableText({
  value,
  onCommit,
  label,
  multiline = false,
  placeholder,
  busy = false,
  required = false,
  className = '',
}: {
  value: string
  onCommit: (next: string) => void
  label: string
  multiline?: boolean
  placeholder?: string
  busy?: boolean
  required?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  // A regeneration or another client's change can replace the value underneath
  // an idle field; adopt it, but never while the user is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  function commit() {
    setEditing(false)
    const next = draft.trim()
    if (required && next.length === 0) {
      setLocalError(`${label} cannot be empty`)
      setDraft(value)
      return
    }
    setLocalError(null)
    if (next === value.trim()) return
    onCommit(next)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
    setLocalError(null)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    // Enter commits a single line; a textarea needs a modifier so newlines work.
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }

  const shared = {
    ref: ref as never,
    value: draft,
    placeholder,
    'aria-label': label,
    'aria-invalid': localError ? true : undefined,
    disabled: busy,
    onFocus: () => setEditing(true),
    onBlur: commit,
    onKeyDown,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    className: `w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-900 ${
      localError ? 'border-red-300' : editing ? 'border-indigo-400' : 'border-transparent hover:border-slate-300'
    } ${busy ? 'opacity-60' : ''} ${className}`,
  }

  return (
    <div className="space-y-1">
      {multiline ? <textarea {...shared} rows={Math.min(10, Math.max(2, draft.split('\n').length + 1))} /> : <input {...shared} />}
      {editing && (
        <p className="px-2 text-[11px] text-slate-400">
          {multiline ? '⌘/Ctrl+Enter' : 'Enter'} to save · Escape to cancel
        </p>
      )}
      {localError && (
        <p role="alert" className="px-2 text-xs font-medium text-red-700">
          {localError}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit** — *present this message to the user; do not run it*

```
feat(web): add click-to-edit field and origin badge showing what survives
```

---

## Task 4: The reader sections

Written as editable-capable components from the start, so the reader and the
builder are one implementation with a flag rather than two that drift.

**Files:**
- Create: `apps/web/components/kit/BriefSection.tsx`
- Create: `apps/web/components/kit/RoleSection.tsx`
- Create: `apps/web/components/kit/CoverageNotice.tsx`
- Create: `apps/web/components/kit/ScheduleView.tsx`
- Create: `apps/web/components/kit/RegenerateButton.tsx`

**Interfaces:**
- Consumes: `Kit`, `Mutations`, `SectionState`, `coverageFor`, `questionsForDay`, `totalMinutes`, `pluralise`, `EditableText`, `Card`, `Button`.
- Produces:
  - `RegenerateButton` — props `{ section: string; label: string; mutations: Mutations; state?: SectionState; willReplace?: number; willKeep?: number }`
  - `BriefSection` — props `{ kit: Kit; mutations: Mutations; sections: Record<string, SectionState> }`
  - `RoleSection` — props `{ kit: Kit }`
  - `CoverageNotice` — props `{ kit: Kit }`
  - `ScheduleView` — props `{ kit: Kit; mutations: Mutations; sections: Record<string, SectionState> }`

- [ ] **Step 1: Write the regenerate button**

`apps/web/components/kit/RegenerateButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { Mutations } from '@/lib/use-kit-mutations'
import type { SectionState } from '@/lib/types'
import { pluralise } from '@/lib/format'

/**
 * Regeneration is confirmed rather than immediate, and the confirmation says
 * exactly what will happen: how many generated items will be replaced, and how
 * many of the user's own will be kept. That sentence is the whole point of the
 * origin model.
 */
export function RegenerateButton({
  section,
  label,
  mutations,
  state,
  willReplace,
  willKeep,
}: {
  section: string
  label: string
  mutations: Mutations
  state?: SectionState
  willReplace?: number
  willKeep?: number
}) {
  const [confirming, setConfirming] = useState(false)
  const busy = mutations.busy.has(`section:${section}`) || state?.status === 'regenerating'

  if (busy) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-slate-600">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-hidden="true" />
        <span role="status">Regenerating {label}</span>
      </span>
    )
  }

  if (!confirming) {
    return (
      <div className="flex items-center gap-2">
        {state?.status === 'failed' && (
          <span className="text-xs font-medium text-red-700" title={state.error ?? undefined}>
            Last attempt failed
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          Regenerate
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-600">
        {willReplace === undefined
          ? `Rebuild ${label}?`
          : `Replaces ${pluralise(willReplace, 'generated item')}${willKeep ? `, keeps ${willKeep} of yours` : ''}.`}
      </span>
      <Button
        size="sm"
        onClick={() => {
          setConfirming(false)
          void mutations.regenerate(section)
        }}
      >
        Regenerate
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Write the brief section**

`apps/web/components/kit/BriefSection.tsx`:

```tsx
'use client'

import { Card } from '@/components/ui/Card'
import { EditableText } from '@/components/kit/EditableText'
import { RegenerateButton } from '@/components/kit/RegenerateButton'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function BriefSection({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const busy = mutations.busy.has('brief')
  const nothingFound = kit.company_brief.sources.length === 0

  return (
    <Card
      title="Company brief"
      actions={<RegenerateButton section="company_brief" label="the brief" mutations={mutations} state={sections.company_brief} />}
    >
      <div className="max-w-prose space-y-4">
        {nothingFound && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nothing could be retrieved about this company, so this brief is honest about that rather than filled in.
          </p>
        )}

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Summary</h3>
          <EditableText
            label="Company summary"
            value={kit.company_brief.summary}
            multiline
            required
            busy={busy}
            className="mt-1 leading-relaxed"
            onCommit={(summary) => void mutations.editBrief({ summary })}
          />
        </div>

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">What they do</h3>
          <EditableText
            label="What they do"
            value={kit.company_brief.what_they_do}
            multiline
            required
            busy={busy}
            className="mt-1 leading-relaxed"
            onCommit={(what_they_do) => void mutations.editBrief({ what_they_do })}
          />
        </div>

        {kit.company_brief.sources.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Sources</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {kit.company_brief.sources.map((url) => (
                <li key={url} className="truncate">
                  <a href={url} target="_blank" rel="noreferrer noopener" className="rounded text-indigo-700 hover:underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
```

- [ ] **Step 3: Write the role section and the coverage notice**

`apps/web/components/kit/RoleSection.tsx`:

```tsx
import { Card } from '@/components/ui/Card'
import { pluralise } from '@/lib/format'
import type { Kit } from '@/lib/types'

const KIND_LABELS = { technical: 'Technical', behavioural: 'Behavioural', domain: 'Domain' } as const

/**
 * Read-only. Requirements are the spine of the kit — every question and
 * flashcard references them by id — so editing them here would silently
 * invalidate those references. Reshaping happens on the questions instead.
 */
export function RoleSection({ kit }: { kit: Kit }) {
  const musts = kit.role.requirements.filter((requirement) => requirement.priority === 'must')

  return (
    <Card title="The role">
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-slate-900">{kit.role.title}</h3>
          <span className="text-sm text-slate-600">{kit.role.seniority}</span>
          {kit.source.location && <span className="text-sm text-slate-500">· {kit.source.location}</span>}
        </div>

        {kit.role.responsibilities.length > 0 && (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Responsibilities</h4>
            <ul className="mt-1.5 max-w-prose list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-800">
              {kit.role.responsibilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Requirements — {pluralise(musts.length, 'must-have')} of {kit.role.requirements.length}
          </h4>
          {kit.role.requirements.length === 0 ? (
            <p className="mt-1.5 max-w-prose text-sm text-slate-600">
              No requirements could be extracted from this description. That usually means the posting was very thin —
              the kit reflects that rather than inventing any.
            </p>
          ) : (
            <ul className="mt-1.5 divide-y divide-slate-100">
              {kit.role.requirements.map((requirement) => {
                const uncovered = kit.coverage.uncovered_requirement_ids.includes(requirement.id)
                return (
                  <li key={requirement.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
                    <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{requirement.id}</code>
                    <span className="min-w-0 flex-1 text-slate-800">{requirement.text}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        requirement.priority === 'must' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {requirement.priority === 'must' ? 'Must' : 'Nice'}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">{KIND_LABELS[requirement.kind]}</span>
                    {uncovered && (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                        No question yet
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
```

`apps/web/components/kit/CoverageNotice.tsx`:

```tsx
import { coverageFor } from '@/lib/kit-derive'
import { pluralise } from '@/lib/format'
import type { Kit } from '@/lib/types'

/**
 * Coverage is stated plainly because it is the one claim the kit makes about
 * itself. An uncovered must-have is a real gap and is named; an uncovered
 * nice-to-have is reported without alarm.
 */
export function CoverageNotice({ kit }: { kit: Kit }) {
  const { uncovered, uncoveredMust, coveredCount, total } = coverageFor(kit)

  if (total === 0) return null

  if (uncovered.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        Every one of the {total} requirements has at least one question against it, after{' '}
        {pluralise(kit.coverage.passes, 'pass', 'passes')}.
      </p>
    )
  }

  const tone = uncoveredMust.length > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'

  return (
    <div className={`rounded-lg border px-4 py-2.5 text-sm ${tone}`}>
      <p>
        {coveredCount} of {total} requirements have a question, after {pluralise(kit.coverage.passes, 'pass', 'passes')}.
        {uncoveredMust.length > 0
          ? ` ${pluralise(uncoveredMust.length, 'must-have')} still uncovered.`
          : ' The remainder are nice-to-haves.'}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {uncovered.map((requirement) => (
          <li key={requirement.id}>
            <code className="rounded bg-white/60 px-1 py-0.5">{requirement.id}</code> {requirement.text}
            {requirement.priority === 'must' && <strong> (must-have)</strong>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs">
        Add a question against one of these by hand, or regenerate that category — the coverage check runs again either
        way.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Write the schedule view**

`apps/web/components/kit/ScheduleView.tsx`:

```tsx
'use client'

import { Card } from '@/components/ui/Card'
import { RegenerateButton } from '@/components/kit/RegenerateButton'
import { pluralise } from '@/lib/format'
import { questionsForDay, totalMinutes } from '@/lib/kit-derive'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function ScheduleView({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const minutes = totalMinutes(kit)

  return (
    <Card
      title={`Study schedule — ${pluralise(kit.schedule.days_available, 'day')}`}
      actions={<RegenerateButton section="schedule" label="the schedule" mutations={mutations} state={sections.schedule} />}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {Math.round(minutes / 60)} hours across {pluralise(kit.schedule.days.length, 'day')}. Harder and required
          material is placed first, so the night before is review rather than new ground. This allocation is arithmetic
          in the application, not something the model decided.
        </p>

        <ol className="space-y-2">
          {kit.schedule.days.map((day) => {
            const questions = questionsForDay(kit, day.day)
            return (
              <li key={day.day} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Day {day.day}</h3>
                  <span className="text-xs tabular-nums text-slate-500">
                    {day.minutes} min · {pluralise(questions.length, 'question')}
                  </span>
                </div>
                <p className="mt-0.5 max-w-prose text-sm text-slate-700">{day.focus}</p>
                {questions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {questions.map((question) => (
                      <li key={question.id} className="flex items-start gap-2 text-xs text-slate-600">
                        <code className="shrink-0 rounded bg-slate-100 px-1 py-0.5">{question.id}</code>
                        <span className="min-w-0 flex-1 truncate">{question.prompt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </Card>
  )
}
```

- [ ] **Step 5: Commit** — *present this message to the user; do not run it*

```
feat(web): add brief, role, coverage and schedule reader sections
```

---

## Task 5: The question bank — edit, reorder, move, add, delete, regenerate

**Files:**
- Create: `apps/web/components/kit/QuestionCard.tsx`
- Create: `apps/web/components/kit/QuestionList.tsx`
- Create: `apps/web/components/kit/QuestionBank.tsx`

**Interfaces:**
- Consumes: `Mutations`, `Question`, `Requirement`, `Kit`, `SectionState`, `move`, `groupByCategory`, `CATEGORY_ORDER`, `CATEGORY_LABELS`, `sectionKeyForCategory`, `survivesRegeneration`, `OriginBadge`, `EditableText`, `RegenerateButton`, `Button`, `Card`.
- Produces:
  - `QuestionCard` — props `{ question; requirements: Map<string, Requirement>; mutations; index: number; count: number; onMoveWithin: (from: number, to: number) => void; dragHandlers }`
  - `QuestionList` — props `{ category; questions; kit; mutations; sections }`
  - `QuestionBank` — props `{ kit; mutations; sections }`

Reordering: a card is draggable, and also carries Move up / Move down buttons.
The keyboard route is the primary one — the brief requires keyboard navigability
and native drag-and-drop is unusable without a pointer. Both call the same
`move` function and the same `reorderQuestions` mutation, which sends the full
id list for the whole bank so the server can validate the set.

- [ ] **Step 1: Write the question card**

`apps/web/components/kit/QuestionCard.tsx`:

```tsx
'use client'

import { useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { EditableText } from '@/components/kit/EditableText'
import { OriginBadge } from '@/components/kit/OriginBadge'
import { CATEGORY_LABELS, CATEGORY_ORDER, survivesRegeneration } from '@/lib/kit-derive'
import type { Question, QuestionCategory, Requirement } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function QuestionCard({
  question,
  requirements,
  mutations,
  index,
  count,
  onMoveWithin,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  question: Question
  requirements: Map<string, Requirement>
  mutations: Mutations
  index: number
  count: number
  onMoveWithin: (from: number, to: number) => void
  onDragStart: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const busy = mutations.busy.has(`question:${question.id}`)
  const safe = survivesRegeneration(question)

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`rounded-md border p-3 ${safe ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-white'} ${busy ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="cursor-grab select-none text-slate-400" title="Drag to reorder">
            ⠿
          </span>
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{question.id}</code>
          <OriginBadge origin={question.origin} pinned={question.pinned} />
        </div>

        <div className="flex items-center gap-1">
          {/* The keyboard route to reordering. Drag is an addition, not the only way. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => onMoveWithin(index, index - 1)}
            aria-label={`Move ${question.id} earlier`}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={index === count - 1}
            onClick={() => onMoveWithin(index, index + 1)}
            aria-label={`Move ${question.id} later`}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void mutations.pinQuestion(question.id, !question.pinned)}
            aria-pressed={question.pinned}
            aria-label={question.pinned ? `Unpin ${question.id}` : `Pin ${question.id}`}
          >
            {question.pinned ? 'Unpin' : 'Pin'}
          </Button>
          {confirmingDelete ? (
            <>
              <Button variant="danger" size="sm" onClick={() => void mutations.deleteQuestion(question.id)}>
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)} aria-label={`Delete ${question.id}`}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 max-w-prose space-y-2">
        <EditableText
          label={`Question ${question.id}`}
          value={question.prompt}
          multiline
          required
          busy={busy}
          className="font-medium leading-relaxed"
          onCommit={(prompt) => void mutations.editQuestion(question.id, { prompt })}
        />
        <div>
          <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Answer outline</span>
          <EditableText
            label={`Answer outline for ${question.id}`}
            value={question.answer_outline}
            multiline
            busy={busy}
            placeholder="What a strong answer covers…"
            className="leading-relaxed text-slate-700"
            onCommit={(answer_outline) => void mutations.editQuestion(question.id, { answer_outline })}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5 text-slate-600">
          Difficulty
          <select
            value={question.difficulty}
            disabled={busy}
            onChange={(event) => void mutations.editQuestion(question.id, { difficulty: Number(event.target.value) as 1 | 2 | 3 })}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            aria-label={`Difficulty for ${question.id}`}
          >
            <option value={1}>1 — warm-up</option>
            <option value={2}>2 — standard</option>
            <option value={3}>3 — stretch</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-slate-600">
          Category
          <select
            value={question.category}
            disabled={busy}
            onChange={(event) => void mutations.moveQuestionToCategory(question.id, event.target.value as QuestionCategory)}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            aria-label={`Category for ${question.id}`}
          >
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>

        <span className="flex flex-wrap items-center gap-1 text-slate-500">
          Covers
          {question.requirement_ids.length === 0 ? (
            <span className="text-amber-700">nothing — this counts against no requirement</span>
          ) : (
            question.requirement_ids.map((id) => (
              <code key={id} className="rounded bg-slate-100 px-1 py-0.5" title={requirements.get(id)?.text ?? 'unknown requirement'}>
                {id}
              </code>
            ))
          )}
        </span>
      </div>
    </li>
  )
}
```

- [ ] **Step 2: Write the per-category list**

`apps/web/components/kit/QuestionList.tsx`:

```tsx
'use client'

import { useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, inputClass } from '@/components/ui/Field'
import { QuestionCard } from '@/components/kit/QuestionCard'
import { RegenerateButton } from '@/components/kit/RegenerateButton'
import { CATEGORY_LABELS, requirementMap, sectionKeyForCategory, survivesRegeneration } from '@/lib/kit-derive'
import { move } from '@/lib/reorder'
import { pluralise } from '@/lib/format'
import type { Kit, Question, QuestionCategory, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function QuestionList({
  category,
  questions,
  kit,
  mutations,
  sections,
}: {
  category: QuestionCategory
  questions: Question[]
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftRequirement, setDraftRequirement] = useState(kit.role.requirements[0]?.id ?? '')

  const requirements = requirementMap(kit)
  const section = sectionKeyForCategory(category)
  const willKeep = questions.filter(survivesRegeneration).length
  const willReplace = questions.length - willKeep

  /**
   * Reordering within a category is expressed as a reorder of the whole bank:
   * the server validates the full id set, which makes a partial or stale list
   * impossible to apply.
   */
  function reorderWithin(from: number, to: number) {
    const reordered = move(questions, from, to)
    const others = kit.questions.filter((question) => question.category !== category)
    const firstIndex = kit.questions.findIndex((question) => question.category === category)
    const ids = [
      ...kit.questions
        .slice(0, Math.max(firstIndex, 0))
        .filter((question) => question.category !== category)
        .map((question) => question.id),
      ...reordered.map((question) => question.id),
      ...others.slice(others.length - Math.max(0, others.length)).map((question) => question.id),
    ]
    // Deduplicate while keeping first occurrence, then append anything missed.
    const seen = new Set<string>()
    const ordered = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    for (const question of kit.questions) if (!seen.has(question.id)) ordered.push(question.id)

    void mutations.reorderQuestions(ordered)
  }

  function onDrop(event: DragEvent, index: number) {
    event.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    reorderWithin(dragIndex, index)
    setDragIndex(null)
  }

  async function addQuestion() {
    const prompt = draft.trim()
    if (prompt.length === 0) return
    await mutations.addQuestion({
      category,
      prompt,
      requirement_ids: draftRequirement ? [draftRequirement] : [],
      difficulty: 2,
    })
    setDraft('')
    setAdding(false)
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">{CATEGORY_LABELS[category]}</h3>
          <p className="text-xs text-slate-500">
            {pluralise(questions.length, 'question')}
            {willKeep > 0 && ` · ${willKeep} yours`}
          </p>
        </div>
        <RegenerateButton
          section={section}
          label={CATEGORY_LABELS[category].toLowerCase()}
          mutations={mutations}
          state={sections[section]}
          willReplace={willReplace}
          willKeep={willKeep}
        />
      </header>

      {questions.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-3 py-4 text-sm text-slate-600">
          No {CATEGORY_LABELS[category].toLowerCase()} questions. Add one by hand, or regenerate this category.
        </p>
      ) : (
        <ul className="space-y-2">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              requirements={requirements}
              mutations={mutations}
              index={index}
              count={questions.length}
              onMoveWithin={reorderWithin}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, index)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
          <Field label="New question" id={`new-${category}`}>
            <textarea
              id={`new-${category}`}
              rows={3}
              className={inputClass}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="What would you want to be asked?"
            />
          </Field>
          {kit.role.requirements.length > 0 && (
            <Field label="Covers requirement" id={`req-${category}`} hint="Linking it means the coverage check counts it.">
              <select
                id={`req-${category}`}
                className={inputClass}
                value={draftRequirement}
                onChange={(event) => setDraftRequirement(event.target.value)}
              >
                {kit.role.requirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.id} — {requirement.text}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="flex gap-2">
            <Button size="sm" loading={mutations.busy.has(`add:${category}`)} onClick={() => void addQuestion()}>
              Add question
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          Add a question
        </Button>
      )}
    </section>
  )
}
```

The `reorderWithin` id assembly above is convoluted. Simplify it while writing
the file: build the full order as *every question in `kit.questions` order,
with the questions of this category replaced by the reordered sequence in the
positions they already occupy*. A clear implementation:

```ts
function fullOrderWithCategoryReordered(kit: Kit, category: QuestionCategory, reordered: Question[]): string[] {
  const queue = [...reordered]
  return kit.questions.map((question) => (question.category === category ? queue.shift()!.id : question.id))
}
```

Use that, and delete the `others`/`firstIndex`/dedupe block.

- [ ] **Step 3: Write the bank**

`apps/web/components/kit/QuestionBank.tsx`:

```tsx
'use client'

import { QuestionList } from '@/components/kit/QuestionList'
import { CoverageNotice } from '@/components/kit/CoverageNotice'
import { CATEGORY_ORDER, groupByCategory } from '@/lib/kit-derive'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function QuestionBank({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const grouped = groupByCategory(kit.questions)

  return (
    <div className="space-y-4">
      <CoverageNotice kit={kit} />
      {CATEGORY_ORDER.map((category) => (
        <QuestionList
          key={category}
          category={category}
          questions={grouped[category]}
          kit={kit}
          mutations={mutations}
          sections={sections}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Verify by hand — this is the section the video must show**

1. Edit a question's prompt, blur — the badge changes from Generated to Edited, and the card gains its highlight.
2. Type in a prompt without blurring — no network request until commit (watch the network panel).
3. Press Escape mid-edit — the original text returns.
4. Empty a prompt and blur — refused locally with a message; nothing is sent.
5. Pin a generated question — badge shows Pinned, text unchanged, origin still Generated.
6. Regenerate Technical — the confirmation states how many will be replaced and how many kept. Confirm: the edited and pinned questions are still there, with their text, and new generated questions have appeared around them.
7. Check another category and the brief — untouched by that regeneration.
8. Move a question with the arrow buttons, keyboard only — order changes and persists across a reload.
9. Drag a question — same result.
10. Change a question's category with the select — it moves and is now marked Edited.
11. Add a question by hand — badge reads Yours. Regenerate its category — it survives.
12. Delete a scheduled question — it leaves the schedule too, and the coverage notice updates.
13. Stop the API and edit — the change appears, then rolls back with a readable message.

- [ ] **Step 5: Commit** — *present this message to the user; do not run it*

```
feat(web): add the question bank builder with reorder, move and regenerate
```

---

## Task 6: Flashcard list and the assembled kit page

**Files:**
- Create: `apps/web/components/kit/FlashcardList.tsx`
- Create: `apps/web/components/kit/SectionTabs.tsx`
- Modify: `apps/web/app/kits/[id]/page.tsx`

**Interfaces:**
- Consumes: everything above, plus `useKit`, `useKitMutations`, `ProgressPanel`, `WarningList`, `StatusBadge`, `RequireAuth`.
- Produces:
  - `FlashcardList` — props `{ kit; mutations; sections }`
  - `SectionTabs` — props `{ tabs: { id: string; label: string; badge?: string }[]; active: string; onChange: (id: string) => void }`

- [ ] **Step 1: Write the flashcard list**

`apps/web/components/kit/FlashcardList.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'
import { EditableText } from '@/components/kit/EditableText'
import { OriginBadge } from '@/components/kit/OriginBadge'
import { pluralise } from '@/lib/format'
import { requirementMap, survivesRegeneration } from '@/lib/kit-derive'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function FlashcardList({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const [adding, setAdding] = useState(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const requirements = requirementMap(kit)

  async function add() {
    if (front.trim().length === 0) return
    await mutations.addFlashcard({ front: front.trim(), back: back.trim(), requirement_ids: kit.role.requirements[0] ? [kit.role.requirements[0].id] : [] })
    setFront('')
    setBack('')
    setAdding(false)
  }

  return (
    <Card
      title={`Flashcards — ${pluralise(kit.flashcards.length, 'card')}`}
      actions={
        kit.flashcards.length > 0 ? (
          <Link href={`/kits/${''}`} className="hidden" aria-hidden="true">
            {/* Practice mode arrives in Phase 4; the link is added there. */}
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {kit.flashcards.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-4 text-sm text-slate-600">
            No flashcards yet. Add one by hand below.
          </p>
        ) : (
          <ul className="space-y-2">
            {kit.flashcards.map((card) => {
              const busy = mutations.busy.has(`flashcard:${card.id}`)
              const safe = survivesRegeneration(card)
              return (
                <li
                  key={card.id}
                  className={`rounded-md border p-3 ${safe ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-white'} ${busy ? 'opacity-70' : ''}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{card.id}</code>
                      <OriginBadge origin={card.origin} pinned={card.pinned} />
                      {card.requirement_ids.map((id) => (
                        <code
                          key={id}
                          className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-600"
                          title={requirements.get(id)?.text ?? 'unknown requirement'}
                        >
                          {id}
                        </code>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={card.pinned}
                        onClick={() => void mutations.pinFlashcard(card.id, !card.pinned)}
                        aria-label={card.pinned ? `Unpin ${card.id}` : `Pin ${card.id}`}
                      >
                        {card.pinned ? 'Unpin' : 'Pin'}
                      </Button>
                      {confirmingId === card.id ? (
                        <>
                          <Button variant="danger" size="sm" onClick={() => void mutations.deleteFlashcard(card.id)}>
                            Delete
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmingId(card.id)} aria-label={`Delete ${card.id}`}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Front</span>
                      <EditableText
                        label={`Front of ${card.id}`}
                        value={card.front}
                        multiline
                        required
                        busy={busy}
                        onCommit={(next) => void mutations.editFlashcard(card.id, { front: next })}
                      />
                    </div>
                    <div>
                      <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Back</span>
                      <EditableText
                        label={`Back of ${card.id}`}
                        value={card.back}
                        multiline
                        busy={busy}
                        onCommit={(next) => void mutations.editFlashcard(card.id, { back: next })}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {adding ? (
          <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
            <Field label="Front" id="new-card-front">
              <input id="new-card-front" className={inputClass} value={front} onChange={(event) => setFront(event.target.value)} />
            </Field>
            <Field label="Back" id="new-card-back">
              <textarea id="new-card-back" rows={2} className={inputClass} value={back} onChange={(event) => setBack(event.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" loading={mutations.busy.has('add:flashcard')} onClick={() => void add()}>
                Add card
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Add a flashcard
          </Button>
        )}
      </div>
    </Card>
  )
}
```

Note: the `actions` prop above contains a placeholder link. Delete that block
entirely when writing the file — Phase 4 adds the practice link properly. A
`Card` with no actions is correct here.

- [ ] **Step 2: Write the tabs**

`apps/web/components/kit/SectionTabs.tsx`:

```tsx
'use client'

import { useRef, type KeyboardEvent } from 'react'

/**
 * Roving-tabindex tablist: arrow keys move between tabs, which is what a
 * keyboard user expects and what a row of plain buttons does not give them.
 */
export function SectionTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; badge?: string }[]
  active: string
  onChange: (id: string) => void
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === active)
    if (index < 0) return
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]!
    onChange(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div role="tablist" aria-label="Kit sections" onKeyDown={onKeyDown} className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[tab.id] = element
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`-mb-px rounded-t border-b-2 px-3 py-2 text-sm font-medium ${
              selected ? 'border-indigo-600 text-indigo-800' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
            {tab.badge && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{tab.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Assemble the kit page**

Replace the `doc.kit &&` branch from Phase 2 with the reader and builder. The
progress and failure branches stay exactly as they were.

`apps/web/app/kits/[id]/page.tsx` — the parts that change:

```tsx
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { BriefSection } from '@/components/kit/BriefSection'
import { FlashcardList } from '@/components/kit/FlashcardList'
import { QuestionBank } from '@/components/kit/QuestionBank'
import { RoleSection } from '@/components/kit/RoleSection'
import { ScheduleView } from '@/components/kit/ScheduleView'
import { SectionTabs } from '@/components/kit/SectionTabs'
import { ProgressPanel } from '@/components/progress/ProgressPanel'
import { WarningList } from '@/components/progress/WarningList'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { pluralise } from '@/lib/format'
import { useKit } from '@/lib/use-kit'
import { useKitMutations } from '@/lib/use-kit-mutations'

function Builder({ id }: { id: string }) {
  const { doc, error, loading, refresh, setDoc } = useKit(id)
  const [tab, setTab] = useState('overview')

  if (loading) return <StateBlock state="loading" title="Loading this kit" />
  if (error || !doc) {
    return (
      <StateBlock
        state="error"
        title="Could not load this kit"
        detail={error ?? 'it may have been deleted'}
        action={
          <Link href="/kits">
            <Button variant="secondary">Back to my kits</Button>
          </Link>
        }
      />
    )
  }

  // The hook is called unconditionally above this point; doc is settled here.
  const mutations = useKitMutations({ doc, setDoc, refresh })
  const kit = doc.kit

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{kit?.role.title ?? 'Building your kit'}</h1>
          <p className="text-sm text-slate-600">
            {kit?.source.company ?? doc.input.companyUrl} · {pluralise(doc.input.days, 'day')} to prepare
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {doc.status === 'failed' && (
        <StateBlock
          state="error"
          title="This kit could not be generated"
          detail={doc.error?.message ?? 'the run failed before a kit could be produced'}
          action={
            <Link href="/kits/new">
              <Button variant="secondary">Start another</Button>
            </Link>
          }
        />
      )}

      {(doc.status === 'queued' || doc.status === 'running') && (
        <Card title="Progress">
          <ProgressPanel progress={doc.progress} status={doc.status} />
        </Card>
      )}

      {mutations.error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{mutations.error}</span>
          <button type="button" onClick={mutations.clearError} className="rounded font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {kit && (
        <>
          <WarningList warnings={kit.warnings} />

          <SectionTabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'questions', label: 'Questions', badge: String(kit.questions.length) },
              { id: 'flashcards', label: 'Flashcards', badge: String(kit.flashcards.length) },
              { id: 'schedule', label: 'Schedule', badge: String(kit.schedule.days_available) },
            ]}
          />

          <div role="tabpanel">
            {tab === 'overview' && (
              <div className="space-y-6">
                <BriefSection kit={kit} mutations={mutations} sections={doc.sections} />
                <RoleSection kit={kit} />
              </div>
            )}
            {tab === 'questions' && <QuestionBank kit={kit} mutations={mutations} sections={doc.sections} />}
            {tab === 'flashcards' && <FlashcardList kit={kit} mutations={mutations} sections={doc.sections} />}
            {tab === 'schedule' && <ScheduleView kit={kit} mutations={mutations} sections={doc.sections} />}
          </div>
        </>
      )}
    </div>
  )
}

export default function KitPage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <Builder id={params.id} />
    </RequireAuth>
  )
}
```

**React hooks rule:** `useKitMutations` must not sit below an early return.
Restructure so the guard is a wrapper: an outer component calls `useKit` and
renders either a state block or an inner `<KitBuilder doc=… setDoc=… refresh=… />`
that calls `useKitMutations` at its top. Do that rather than leaving the code
as written above, which violates the hooks rule.

- [ ] **Step 4: Run the tests and check types**

Run: `npx vitest run` then `npx tsc --noEmit -p apps/web`
Expected: PASS; no type errors and no hooks-rule lint error.

- [ ] **Step 5: Verify the whole builder by hand**

Run through every numbered check in Task 5, Step 4, plus:

1. Tabs are operable with arrow keys and the panel changes.
2. On a phone-width window every card reflows, no horizontal scrolling, and the reorder buttons remain reachable.
3. Edit the brief, then regenerate a question category — the edited brief is untouched.
4. Regenerate the schedule — question ids are unchanged and every day is still filled.
5. Reload after every kind of edit — everything persisted.

- [ ] **Step 6: Commit** — *present this message to the user; do not run it*

```
feat(web): assemble the kit reader and builder with tabbed sections
```

---

## Phase 3 done when

- Every question, flashcard and brief field can be edited inline, and an edit sends one request on commit rather than one per keystroke.
- Questions can be reordered by keyboard and by drag, and moved between categories.
- Questions and flashcards can be added by hand and deleted, and deleting a scheduled question does not leave a dangling reference.
- Each section regenerates on its own, and an edited, hand-written or pinned item survives it — visibly marked as such before the button is pressed.
- A failed regeneration leaves the previous content in place and says so.
- A failed edit rolls back with the API's own message.
- `npx vitest run` is green and `npx tsc --noEmit -p apps/web` is clean.

Next: `phase-4-practice-and-polish.md` — practice mode, coverage display, and
the accessibility and responsiveness pass.
