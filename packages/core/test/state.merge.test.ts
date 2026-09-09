import { describe, expect, it } from 'vitest'
import { mergeRegenerated, nextIdAfter, partitionForRegeneration, sectionKeyForCategory } from '../src/state/merge.js'
import type { Question } from '../src/schema/kit.js'

function q(id: string, origin: Question['origin'], pinned = false): Question {
  return {
    id,
    requirement_ids: ['r1'],
    category: 'technical',
    prompt: `prompt ${id}`,
    answer_outline: '',
    difficulty: 2,
    origin,
    pinned,
    rev: 0,
  }
}

describe('partitionForRegeneration', () => {
  it('replaces generated, unpinned items', () => {
    const { keep, replace } = partitionForRegeneration([q('q1', 'generated')])
    expect(keep).toEqual([])
    expect(replace.map((i) => i.id)).toEqual(['q1'])
  })

  it('keeps an edited item', () => {
    const { keep, replace } = partitionForRegeneration([q('q1', 'edited')])
    expect(keep.map((i) => i.id)).toEqual(['q1'])
    expect(replace).toEqual([])
  })

  it('keeps a hand-written item', () => {
    expect(partitionForRegeneration([q('q1', 'manual')]).keep.map((i) => i.id)).toEqual(['q1'])
  })

  it('keeps a pinned generated item', () => {
    expect(partitionForRegeneration([q('q1', 'generated', true)]).keep.map((i) => i.id)).toEqual(['q1'])
  })

  it('splits a mixed set correctly', () => {
    const { keep, replace } = partitionForRegeneration([
      q('q1', 'generated'),
      q('q2', 'edited'),
      q('q3', 'generated', true),
      q('q4', 'manual'),
      q('q5', 'generated'),
    ])
    expect(keep.map((i) => i.id)).toEqual(['q2', 'q3', 'q4'])
    expect(replace.map((i) => i.id)).toEqual(['q1', 'q5'])
  })
})

describe('mergeRegenerated', () => {
  it('puts kept items first, then the new ones', () => {
    const merged = mergeRegenerated([q('q2', 'edited')], [q('q7', 'generated')])
    expect(merged.map((i) => i.id)).toEqual(['q2', 'q7'])
  })

  it('never drops a kept item', () => {
    const kept = [q('q2', 'edited'), q('q3', 'generated', true)]
    expect(mergeRegenerated(kept, []).map((i) => i.id)).toEqual(['q2', 'q3'])
  })

  it('ignores an incoming item that collides with a kept id', () => {
    const merged = mergeRegenerated([q('q2', 'edited')], [q('q2', 'generated'), q('q9', 'generated')])
    expect(merged.map((i) => i.id)).toEqual(['q2', 'q9'])
    expect(merged.find((i) => i.id === 'q2')!.origin).toBe('edited')
  })
})

describe('nextIdAfter', () => {
  it('continues after the highest existing suffix', () => {
    expect(nextIdAfter('q', [{ id: 'q1' }, { id: 'q7' }, { id: 'q3' }])()).toBe('q8')
  })

  it('does not reuse an id after a delete', () => {
    const next = nextIdAfter('q', [{ id: 'q1' }, { id: 'q2' }])
    expect(next()).toBe('q3')
    expect(next()).toBe('q4')
  })

  it('starts at one for an empty list', () => {
    expect(nextIdAfter('f', [])()).toBe('f1')
  })

  it('ignores ids that do not match the prefix pattern', () => {
    expect(nextIdAfter('q', [{ id: 'weird' }, { id: 'q2' }])()).toBe('q3')
  })
})

describe('sectionKeyForCategory', () => {
  it('maps each category to its section key', () => {
    expect(sectionKeyForCategory('technical')).toBe('questions_technical')
    expect(sectionKeyForCategory('system-design')).toBe('questions_system-design')
  })
})
