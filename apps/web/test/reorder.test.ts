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
