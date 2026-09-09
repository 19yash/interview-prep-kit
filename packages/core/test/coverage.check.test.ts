import { describe, expect, it } from 'vitest'
import { checkCoverage } from '../src/coverage/check.js'
import type { Question, Requirement } from '../src/schema/kit.js'

function req(id: string, priority: 'must' | 'nice' = 'must'): Requirement {
  return { id, text: `requirement ${id}`, kind: 'technical', priority }
}

function q(id: string, requirement_ids: string[]): Question {
  return {
    id,
    requirement_ids,
    category: 'technical',
    prompt: `prompt ${id}`,
    answer_outline: '',
    difficulty: 2,
    origin: 'generated',
    pinned: false,
    rev: 0,
  }
}

describe('checkCoverage', () => {
  it('reports a requirement with no question against it', () => {
    const report = checkCoverage([req('r1'), req('r2')], [q('q1', ['r1'])])
    expect(report.uncovered_requirement_ids).toEqual(['r2'])
    expect(report.covered_requirement_ids).toEqual(['r1'])
  })

  it('treats a must requirement with a question as covered', () => {
    const report = checkCoverage([req('r1')], [q('q1', ['r1'])])
    expect(report.uncovered_requirement_ids).toEqual([])
    expect(report.is_complete).toBe(true)
  })

  it('is not complete while a must requirement is uncovered', () => {
    const report = checkCoverage([req('r1', 'must')], [])
    expect(report.uncovered_must_ids).toEqual(['r1'])
    expect(report.is_complete).toBe(false)
  })

  it('is complete when only nice requirements are uncovered', () => {
    const report = checkCoverage([req('r1', 'must'), req('r2', 'nice')], [q('q1', ['r1'])])
    expect(report.uncovered_requirement_ids).toEqual(['r2'])
    expect(report.uncovered_must_ids).toEqual([])
    expect(report.is_complete).toBe(true)
  })

  it('counts a question that covers several requirements once for each', () => {
    const report = checkCoverage([req('r1'), req('r2')], [q('q1', ['r1', 'r2'])])
    expect(report.uncovered_requirement_ids).toEqual([])
  })

  it('ignores question references to requirements that do not exist', () => {
    const report = checkCoverage([req('r1')], [q('q1', ['r9'])])
    expect(report.uncovered_requirement_ids).toEqual(['r1'])
  })

  it('reports every requirement uncovered when there are no questions', () => {
    const report = checkCoverage([req('r1'), req('r2')], [])
    expect(report.uncovered_requirement_ids).toEqual(['r1', 'r2'])
    expect(report.is_complete).toBe(false)
  })

  it('is complete for an empty requirement list', () => {
    const report = checkCoverage([], [])
    expect(report.is_complete).toBe(true)
    expect(report.uncovered_requirement_ids).toEqual([])
  })
})
