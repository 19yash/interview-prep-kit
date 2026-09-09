'use client'

import { CONFIDENCE_LABELS } from '@/lib/practice-stats'

const STYLES: Record<1 | 2 | 3, string> = {
  1: 'border-red-200 bg-white text-red-800 hover:bg-red-50',
  2: 'border-amber-200 bg-white text-amber-900 hover:bg-amber-50',
  3: 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50',
}

/**
 * Three points, each with a word as well as a number. A bare 1–3 scale makes
 * the user guess which end is good, and the numbers exist only because they
 * double as keyboard shortcuts.
 */
export function ConfidenceButtons({
  onRate,
  disabled = false,
  current,
}: {
  onRate: (confidence: 1 | 2 | 3) => void
  disabled?: boolean
  current?: 1 | 2 | 3
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="How confident did you feel?">
      {([1, 2, 3] as const).map((value) => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          onClick={() => onRate(value)}
          aria-pressed={current === value}
          className={`flex-1 rounded-md border px-3 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${STYLES[value]} ${
            current === value ? 'ring-2 ring-offset-1' : ''
          }`}
        >
          {CONFIDENCE_LABELS[value]}
          <span className="ml-1.5 text-xs font-normal opacity-60" aria-hidden="true">
            {value}
          </span>
        </button>
      ))}
    </div>
  )
}
