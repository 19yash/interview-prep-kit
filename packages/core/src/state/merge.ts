import type { Question } from '../schema/kit.js'
import type { Origin, SectionKey } from '../schema/state.js'

type Stateful = { id: string; origin: Origin; pinned: boolean }

/**
 * The rule the whole builder rests on: a regeneration may only replace items
 * the user has not touched. An edit is an act of ownership, so an edited item
 * is as safe as a pinned one.
 */
export function partitionForRegeneration<T extends { origin: Origin; pinned: boolean }>(
  items: T[],
): { keep: T[]; replace: T[] } {
  const keep: T[] = []
  const replace: T[] = []
  for (const item of items) {
    if (item.origin === 'generated' && !item.pinned) replace.push(item)
    else keep.push(item)
  }
  return { keep, replace }
}

/** Kept items win every collision; they are the user's work, not the model's. */
export function mergeRegenerated<T extends Stateful>(kept: T[], incoming: T[]): T[] {
  const keptIds = new Set(kept.map((item) => item.id))
  return [...kept, ...incoming.filter((item) => !keptIds.has(item.id))]
}

/**
 * Continues from the highest suffix present rather than from the array length,
 * so deleting q3 and adding a question does not resurrect the id q3 and quietly
 * inherit its references from a schedule day.
 */
export function nextIdAfter(prefix: 'q' | 'f', existing: { id: string }[]): () => string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  let highest = 0
  for (const item of existing) {
    const match = pattern.exec(item.id)
    if (match?.[1]) highest = Math.max(highest, Number(match[1]))
  }
  let n = highest
  return () => {
    n += 1
    return `${prefix}${n}`
  }
}

export function sectionKeyForCategory(category: Question['category']): SectionKey {
  return `questions_${category}` as SectionKey
}
