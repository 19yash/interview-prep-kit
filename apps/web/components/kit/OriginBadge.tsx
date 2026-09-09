import type { Origin } from '@/lib/types'
import { survivesRegeneration } from '@/lib/kit-derive'

const LABELS: Record<Origin, { text: string; className: string; title: string }> = {
  generated: { text: 'Generated', className: 'bg-slate-100 text-slate-600', title: 'Written by the model. A regeneration of this section will replace it.' },
  edited: { text: 'Edited', className: 'bg-indigo-50 text-indigo-800', title: 'You changed this, so a regeneration will keep it.' },
  manual: { text: 'Yours', className: 'bg-emerald-50 text-emerald-800', title: 'You wrote this, so a regeneration will keep it.' },
}

/**
 * The state model made visible. Someone about to regenerate a section can see
 * at a glance which items will be replaced and which are theirs — which is the
 * difference between a builder people trust and one they are afraid of.
 */
export function OriginBadge({ origin, pinned }: { origin: Origin; pinned: boolean }) {
  const label = LABELS[origin]
  const safe = survivesRegeneration({ origin, pinned })

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${label.className}`} title={label.title}>
        {label.text}
      </span>
      {pinned && (
        <span
          className="inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
          title="Pinned, so a regeneration will keep it."
        >
          Pinned
        </span>
      )}
      <span className="sr-only">{safe ? 'This will survive a regeneration.' : 'A regeneration will replace this.'}</span>
    </span>
  )
}
