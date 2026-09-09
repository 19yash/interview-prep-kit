import type { Kit } from '@/lib/types'

/**
 * Warnings are shown rather than hidden. A skipped source or a thin
 * description is information the user needs when reading the kit, and hiding
 * it would make the kit look more authoritative than it is.
 */
export function WarningList({ warnings }: { warnings: Kit['warnings'] }) {
  if (warnings.length === 0) return null

  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-amber-900">
        {warnings.length === 1 ? '1 thing to know about this kit' : `${warnings.length} things to know about this kit`}
      </summary>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
        {warnings.map((warning, index) => (
          <li key={`${warning.step}-${index}`}>
            <span className="font-medium">{warning.step}</span>: {warning.reason}
            {warning.source && <span className="block truncate text-xs text-amber-800">{warning.source}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}
