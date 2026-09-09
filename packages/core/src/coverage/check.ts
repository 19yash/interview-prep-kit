import type { Question, Requirement } from '../schema/kit.js'

export type CoverageReport = {
  covered_requirement_ids: string[]
  uncovered_requirement_ids: string[]
  uncovered_must_ids: string[]
  is_complete: boolean
}

/**
 * Deliberately deterministic: a set difference between requirement ids and the
 * requirement ids referenced by questions. The brief requires this decision to
 * belong to the code rather than the model, because "is this requirement
 * covered" must be checkable rather than a matter of opinion.
 */
export function checkCoverage(requirements: Requirement[], questions: Question[]): CoverageReport {
  const requirementIds = new Set(requirements.map((r) => r.id))

  const referenced = new Set<string>()
  for (const question of questions) {
    for (const rid of question.requirement_ids) {
      // A reference to a requirement that does not exist covers nothing.
      if (requirementIds.has(rid)) referenced.add(rid)
    }
  }

  const covered_requirement_ids: string[] = []
  const uncovered_requirement_ids: string[] = []
  const uncovered_must_ids: string[] = []

  for (const requirement of requirements) {
    if (referenced.has(requirement.id)) {
      covered_requirement_ids.push(requirement.id)
      continue
    }
    uncovered_requirement_ids.push(requirement.id)
    if (requirement.priority === 'must') uncovered_must_ids.push(requirement.id)
  }

  return {
    covered_requirement_ids,
    uncovered_requirement_ids,
    uncovered_must_ids,
    is_complete: uncovered_must_ids.length === 0,
  }
}
