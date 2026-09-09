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
