import { describe, expect, it } from 'vitest'
import { allocateSchedule, MAX_DAYS } from '../src/schedule/allocate.js'
import type { Question, Requirement } from '../src/schema/kit.js'

function req(id: string, priority: 'must' | 'nice', text = `topic ${id}`): Requirement {
  return { id, text, kind: 'technical', priority }
}

function q(id: string, requirement_ids: string[], difficulty: 1 | 2 | 3): Question {
  return {
    id,
    requirement_ids,
    category: 'technical',
    prompt: `prompt ${id}`,
    answer_outline: '',
    difficulty,
    origin: 'generated',
    pinned: false,
    rev: 0,
  }
}

const requirements = [req('r1', 'must', 'Node.js internals'), req('r2', 'must', 'Postgres tuning'), req('r3', 'nice', 'Terraform')]
const questions = [
  q('q1', ['r1'], 1),
  q('q2', ['r1'], 3),
  q('q3', ['r2'], 2),
  q('q4', ['r3'], 2),
  q('q5', ['r2'], 3),
]

describe('allocateSchedule', () => {
  it('produces exactly the number of days requested', () => {
    for (const days of [1, 2, 3, 5, 7, 14]) {
      const schedule = allocateSchedule({ questions, requirements, days })
      expect(schedule.days).toHaveLength(days)
      expect(schedule.days_available).toBe(days)
    }
  })

  it('numbers days from one upward with no gaps', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 4 })
    expect(schedule.days.map((d) => d.day)).toEqual([1, 2, 3, 4])
  })

  it('puts everything on day one for a one-day schedule', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 1 })
    expect(schedule.days).toHaveLength(1)
    expect(schedule.days[0]!.question_ids.sort()).toEqual(['q1', 'q2', 'q3', 'q4', 'q5'])
  })

  it('clamps a 60-day request to 60 days and still fills every day entry', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 60 })
    expect(schedule.days).toHaveLength(60)
    expect(schedule.days_available).toBe(60)
    expect(schedule.days.every((d) => Number.isInteger(d.minutes))).toBe(true)
    expect(schedule.days.every((d) => d.focus.length > 0)).toBe(true)
  })

  it('clamps a request above the maximum', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 500 })
    expect(schedule.days).toHaveLength(MAX_DAYS)
  })

  it('clamps zero and negative day counts to one', () => {
    expect(allocateSchedule({ questions, requirements, days: 0 }).days).toHaveLength(1)
    expect(allocateSchedule({ questions, requirements, days: -3 }).days).toHaveLength(1)
  })

  it('places every must requirement somewhere in the schedule', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 3 })
    const scheduled = new Set(schedule.days.flatMap((d) => d.question_ids))
    const coveredRequirements = new Set(
      questions.filter((question) => scheduled.has(question.id)).flatMap((question) => question.requirement_ids),
    )
    for (const requirement of requirements.filter((r) => r.priority === 'must')) {
      expect(coveredRequirements.has(requirement.id)).toBe(true)
    }
  })

  it('schedules every question exactly once', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 3 })
    const scheduled = schedule.days.flatMap((d) => d.question_ids)
    expect(scheduled).toHaveLength(questions.length)
    expect(new Set(scheduled).size).toBe(questions.length)
  })

  it('lands harder, higher-priority material earlier than easier optional material', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 5 })
    const dayOf = (id: string) => schedule.days.find((d) => d.question_ids.includes(id))!.day
    // q2 is a must requirement at difficulty 3; q4 is a nice requirement at difficulty 2.
    expect(dayOf('q2')).toBeLessThan(dayOf('q4'))
  })

  it('front-loads: no later day carries more questions than an earlier one', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 4 })
    const counts = schedule.days.map((d) => d.question_ids.length)
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!)
    }
  })

  it('uses integer minutes on every day and none negative', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 3, minutesPerDay: 100 })
    for (const day of schedule.days) {
      expect(Number.isInteger(day.minutes)).toBe(true)
      expect(day.minutes).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives an empty day zero minutes and an honest focus', () => {
    const schedule = allocateSchedule({ questions: [q('q1', ['r1'], 2)], requirements: [req('r1', 'must')], days: 3 })
    const empty = schedule.days.filter((d) => d.question_ids.length === 0)
    expect(empty.length).toBe(2)
    for (const day of empty) {
      expect(day.minutes).toBe(0)
      expect(day.focus.toLowerCase()).toContain('review')
    }
  })

  it('derives a focus from the requirement texts on that day', () => {
    const schedule = allocateSchedule({ questions, requirements, days: 1 })
    expect(schedule.days[0]!.focus).toContain('Node.js internals')
  })

  it('handles a kit with no questions without throwing', () => {
    const schedule = allocateSchedule({ questions: [], requirements: [], days: 3 })
    expect(schedule.days).toHaveLength(3)
    expect(schedule.days.every((d) => d.question_ids.length === 0)).toBe(true)
  })
})
