import React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  confidenceLabel,
  requirementConfidence,
  type Attempt,
  type PracticeStats,
  type RequirementConfidenceStatus,
} from '@/lib/practice-stats'
import { pluralise } from '@/lib/format'
import type { Flashcard, Requirement } from '@/lib/types'

const KIND_LABELS: Record<string, string> = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  domain: 'Domain',
}

const STATUS_CONFIG: Record<
  RequirementConfidenceStatus,
  { label: string; badgeClass: string; barClass: string }
> = {
  confident: {
    label: 'Confident',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    barClass: 'bg-emerald-500',
  },
  shaky: {
    label: 'Shaky',
    badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
    barClass: 'bg-amber-500',
  },
  'needs-practice': {
    label: 'Needs practice',
    badgeClass: 'bg-red-50 text-red-800 border-red-200',
    barClass: 'bg-red-500',
  },
  untested: {
    label: 'Not practiced yet',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    barClass: 'bg-slate-300',
  },
}

export function SessionSummary({
  stats,
  ratedThisSession,
  onRestart,
  kitId,
  requirements = [],
  cards = [],
  practiceAttempts = [],
  sessionRatings,
}: {
  stats: PracticeStats
  ratedThisSession: number
  onRestart: () => void
  kitId: string
  requirements?: Requirement[]
  cards?: Flashcard[]
  practiceAttempts?: Attempt[]
  sessionRatings?: Map<string, 1 | 2 | 3>
}) {
  const reqScores = requirementConfidence(requirements, cards, practiceAttempts, sessionRatings)

  return (
    <Card title="Session finished">
      <div className="space-y-6">
        {/* Top Summary Banner */}
        <p className="max-w-prose text-sm text-slate-700">
          You rated {pluralise(ratedThisSession, 'card')} this sitting. Across the whole deck you have seen {stats.seen}{' '}
          of {stats.total}
          {stats.unseen > 0 && `, with ${pluralise(stats.unseen, 'card')} still untouched`}.
        </p>

        {/* Global Deck Breakdown Counters */}
        <dl className="grid grid-cols-3 gap-3 text-sm">
          {(
            [
              ['Not yet', stats.low, 'text-red-800'],
              ['Shaky', stats.medium, 'text-amber-900'],
              ['Confident', stats.high, 'text-emerald-800'],
            ] as const
          ).map(([label, value, tone]) => (
            <div key={label} className="rounded-md border border-slate-200 p-3 bg-slate-50/50">
              <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>

        {/* Requirements Breakdown */}
        {reqScores.length > 0 && (
          <div className="space-y-3 pt-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Confidence against Role Requirements</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                How your flashcard performance maps back to what the employer is asking for in the job description.
              </p>
            </div>

            <div className="space-y-3">
              {reqScores.map((item) => {
                const cfg = STATUS_CONFIG[item.status]
                const pct = item.score ? Math.round((item.score / 3) * 100) : 0

                return (
                  <div
                    key={item.requirement.id}
                    className="rounded-lg border border-slate-200 p-4 transition-colors hover:border-slate-300"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono font-medium text-slate-600">
                          {item.requirement.id}
                        </code>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            item.requirement.priority === 'must'
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {item.requirement.priority === 'must' ? 'Must-have' : 'Nice-to-have'}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {KIND_LABELS[item.requirement.kind] ?? item.requirement.kind}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {item.score !== null && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full transition-all ${cfg.barClass}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="font-semibold tabular-nums text-slate-800">
                              {item.score.toFixed(1)} / 3
                            </span>
                          </div>
                        )}
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
                        >
                          {cfg.label}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-slate-800">{item.requirement.text}</p>

                    {item.cards.length > 0 && (
                      <div className="mt-3 border-t border-slate-100 pt-2 text-xs">
                        <div className="mb-1 text-[11px] font-medium text-slate-400">
                          {pluralise(item.ratedCards, 'card')} practiced of {item.totalCards} for this requirement:
                        </div>
                        <ul className="divide-y divide-slate-50">
                          {item.cards.map(({ card, confidence }) => (
                            <li key={card.id} className="flex items-center justify-between gap-3 py-1">
                              <span className="truncate text-slate-600">{card.front}</span>
                              <span
                                className={`shrink-0 font-medium ${
                                  confidence === 3
                                    ? 'text-emerald-700'
                                    : confidence === 2
                                      ? 'text-amber-800'
                                      : confidence === 1
                                        ? 'text-red-700'
                                        : 'text-slate-400'
                                }`}
                              >
                                {confidence ? confidenceLabel(confidence) : 'Untested'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Weakest Cards Next Up */}
        {stats.weakest.length > 0 && (
          <div className="pt-2">
            <h3 className="text-sm font-semibold text-slate-900">Start with these next time</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Ordered by lowest confidence, then by longest since you last saw them — which is exactly the order the
              next session will use.
            </p>
            <ul className="mt-2 divide-y divide-slate-100">
              {stats.weakest.map(({ card, confidence }) => (
                <li key={card.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 text-slate-800">{card.front}</span>
                  <span className="shrink-0 text-xs font-medium text-slate-600">{confidenceLabel(confidence)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button onClick={onRestart}>Practise again</Button>
          <Link href={`/kits/${kitId}`}>
            <Button variant="secondary">Back to Kit Builder</Button>
          </Link>
        </div>
      </div>
    </Card>
  )
}
