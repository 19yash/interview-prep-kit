import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { confidenceLabel, type PracticeStats } from '@/lib/practice-stats'
import { pluralise } from '@/lib/format'

export function SessionSummary({
  stats,
  ratedThisSession,
  onRestart,
  kitId,
}: {
  stats: PracticeStats
  ratedThisSession: number
  onRestart: () => void
  kitId: string
}) {
  return (
    <Card title="Session finished">
      <div className="space-y-5">
        <p className="max-w-prose text-sm text-slate-700">
          You rated {pluralise(ratedThisSession, 'card')} this sitting. Across the whole deck you have seen {stats.seen}{' '}
          of {stats.total}
          {stats.unseen > 0 && `, with ${pluralise(stats.unseen, 'card')} still untouched`}.
        </p>

        <dl className="grid grid-cols-3 gap-3 text-sm">
          {(
            [
              ['Not yet', stats.low, 'text-red-800'],
              ['Shaky', stats.medium, 'text-amber-900'],
              ['Confident', stats.high, 'text-emerald-800'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="rounded-md border border-slate-200 p-3">
              <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>

        {stats.weakest.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-800">Start with these next time</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Ordered by lowest confidence, then by longest since you last saw them — which is exactly the order the
              next session will use.
            </p>
            <ul className="mt-2 divide-y divide-slate-100">
              {stats.weakest.map(({ card, confidence }) => (
                <li key={card.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 text-slate-800">{card.front}</span>
                  <span className="shrink-0 text-xs text-slate-500">{confidenceLabel(confidence)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={onRestart}>Practise again</Button>
          <Link href={`/kits/${kitId}`}>
            <Button variant="secondary">Back to the kit</Button>
          </Link>
        </div>
      </div>
    </Card>
  )
}
