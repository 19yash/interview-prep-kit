import { pluralise } from '@/lib/format'

export function SessionProgress({
  index,
  total,
  covered,
  deck,
}: {
  index: number
  total: number
  covered: number
  deck: number
}) {
  const position = Math.min(index + 1, total)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-600">
        <span>
          Card {position} of {total}
        </span>
        {/* "Covered" here means cards seen at some point, which is not the same
            claim as requirement coverage — the wording keeps them apart. */}
        <span>
          {covered} of {deck} cards seen so far
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={position}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label="Position in this session"
      >
        <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${(position / Math.max(total, 1)) * 100}%` }} />
      </div>
      <p className="sr-only">{pluralise(deck - covered, 'card')} not yet seen.</p>
    </div>
  )
}
