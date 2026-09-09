'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatRelative, pluralise } from '@/lib/format'
import type { KitSummary } from '@/lib/types'

export function KitListItem({ kit, onDelete }: { kit: KitSummary; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0">
      <div className="min-w-0 space-y-1">
        <Link href={`/kits/${kit.id}`} className="block rounded text-sm font-medium text-slate-900 hover:text-indigo-700">
          {kit.role || 'Untitled role'}
        </Link>
        <p className="truncate text-xs text-slate-500">
          {kit.company} · {pluralise(kit.days, 'day')} · {formatRelative(kit.createdAt)}
          {kit.warningCount > 0 && ` · ${pluralise(kit.warningCount, 'gap')} reported`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={kit.status} />
        {confirming ? (
          <>
            <Button variant="danger" size="sm" onClick={() => onDelete(kit.id)}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete kit for ${kit.role}`}>
            Delete
          </Button>
        )}
      </div>
    </li>
  )
}
