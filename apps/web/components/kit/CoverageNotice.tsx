import { coverageFor } from '@/lib/kit-derive'
import { pluralise } from '@/lib/format'
import type { Kit } from '@/lib/types'

/**
 * Coverage is stated plainly because it is the one claim the kit makes about
 * itself. An uncovered must-have is a real gap and is named; an uncovered
 * nice-to-have is reported without alarm.
 */
export function CoverageNotice({ kit }: { kit: Kit }) {
  const { uncovered, uncoveredMust, coveredCount, total } = coverageFor(kit)

  if (total === 0) return null

  if (uncovered.length === 0) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        Every one of the {total} requirements has at least one question against it, after{' '}
        {pluralise(kit.coverage.passes, 'pass', 'passes')}.
      </p>
    )
  }

  const tone = uncoveredMust.length > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'

  return (
    <div className={`rounded-lg border px-4 py-2.5 text-sm ${tone}`}>
      <p>
        {coveredCount} of {total} requirements have a question, after {pluralise(kit.coverage.passes, 'pass', 'passes')}.
        {uncoveredMust.length > 0
          ? ` ${pluralise(uncoveredMust.length, 'must-have')} still uncovered.`
          : ' The remainder are nice-to-haves.'}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {uncovered.map((requirement) => (
          <li key={requirement.id}>
            <code className="rounded bg-white/60 px-1 py-0.5">{requirement.id}</code> {requirement.text}
            {requirement.priority === 'must' && <strong> (must-have)</strong>}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs">
        Add a question against one of these by hand, or regenerate that category — the coverage check runs again either
        way.
      </p>
    </div>
  )
}
