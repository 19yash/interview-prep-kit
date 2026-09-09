import type { Question, Requirement, Schedule, ScheduleDay } from '../schema/kit.js'

export const MAX_DAYS = 60
export const MINUTES_PER_DAY_DEFAULT = 90

export type AllocateInput = {
  questions: Question[]
  requirements: Requirement[]
  days: number
  minutesPerDay?: number
}

const PRIORITY_RANK = { must: 0, nice: 1 } as const

/**
 * Arithmetic and allocation, deliberately not a prompt. The brief requires the
 * application to distribute material across exactly the days requested, place
 * every must-have somewhere, and land harder and higher-priority work earlier.
 * All three are checkable properties, so they belong in code that can be tested.
 */
export function allocateSchedule(input: AllocateInput): Schedule {
  const dayCount = clampDays(input.days)
  const minutesPerDay = Math.max(0, Math.floor(input.minutesPerDay ?? MINUTES_PER_DAY_DEFAULT))

  const requirementById = new Map(input.requirements.map((r) => [r.id, r]))
  const ordered = [...input.questions].sort((a, b) => rank(a, requirementById) - rank(b, requirementById) || a.id.localeCompare(b.id))

  const buckets: Question[][] = Array.from({ length: dayCount }, () => [])
  // Deal round-robin so earlier days are never lighter than later ones, and
  // the hardest must-have material lands on day one.
  ordered.forEach((question, index) => {
    buckets[index % dayCount]!.push(question)
  })

  const days: ScheduleDay[] = buckets.map((bucket, index) => ({
    day: index + 1,
    focus: focusFor(bucket, requirementById),
    question_ids: bucket.map((q) => q.id),
    minutes: bucket.length === 0 ? 0 : minutesPerDay,
  }))

  return { days_available: dayCount, days }
}

function clampDays(requested: number): number {
  if (!Number.isFinite(requested)) return 1
  const whole = Math.floor(requested)
  if (whole < 1) return 1
  if (whole > MAX_DAYS) return MAX_DAYS
  return whole
}

/**
 * Lower is earlier. Priority dominates difficulty: a hard optional topic should
 * not displace a hard required one.
 */
function rank(question: Question, requirementById: Map<string, Requirement>): number {
  const priorities = question.requirement_ids
    .map((id) => requirementById.get(id)?.priority)
    .filter((p): p is 'must' | 'nice' => p !== undefined)
  const best = priorities.includes('must') ? 'must' : priorities.length > 0 ? 'nice' : 'nice'
  // Difficulty descending, so subtract from the maximum.
  return PRIORITY_RANK[best] * 10 + (3 - question.difficulty)
}

function focusFor(bucket: Question[], requirementById: Map<string, Requirement>): string {
  if (bucket.length === 0) return 'Review and consolidate earlier material'
  const texts: string[] = []
  for (const question of bucket) {
    for (const id of question.requirement_ids) {
      const text = requirementById.get(id)?.text
      if (text && !texts.includes(text)) texts.push(text)
    }
  }
  if (texts.length === 0) return 'General interview preparation'
  return texts.slice(0, 3).join(', ')
}
