'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { Mutations } from '@/lib/use-kit-mutations'
import type { SectionState } from '@/lib/types'
import { pluralise } from '@/lib/format'

/**
 * Regeneration is confirmed rather than immediate, and the confirmation says
 * exactly what will happen: how many generated items will be replaced, and how
 * many of the user's own will be kept. That sentence is the whole point of the
 * origin model.
 */
export function RegenerateButton({
  section,
  label,
  mutations,
  state,
  willReplace,
  willKeep,
}: {
  section: string
  label: string
  mutations: Mutations
  state?: SectionState
  willReplace?: number
  willKeep?: number
}) {
  const [confirming, setConfirming] = useState(false)
  const busy = mutations.busy.has(`section:${section}`) || state?.status === 'regenerating'

  if (busy) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-slate-600">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-hidden="true" />
        <span role="status">Regenerating {label}</span>
      </span>
    )
  }

  if (!confirming) {
    return (
      <div className="flex items-center gap-2">
        {state?.status === 'failed' && (
          <span className="text-xs font-medium text-red-700" title={state.error ?? undefined}>
            Last attempt failed
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          Regenerate
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-600">
        {willReplace === undefined
          ? `Rebuild ${label}?`
          : `Replaces ${pluralise(willReplace, 'generated item')}${willKeep ? `, keeps ${willKeep} of yours` : ''}.`}
      </span>
      <Button
        size="sm"
        onClick={() => {
          setConfirming(false)
          void mutations.regenerate(section)
        }}
      >
        Regenerate
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  )
}
