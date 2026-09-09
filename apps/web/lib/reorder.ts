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
