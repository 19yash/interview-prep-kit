import type { KitStatus } from '@/lib/types'

// Colour is never the only signal: every badge carries its word.
const LABELS: Record<KitStatus, { text: string; className: string }> = {
  queued: { text: 'Queued', className: 'bg-slate-100 text-slate-700' },
  running: { text: 'Generating', className: 'bg-indigo-50 text-indigo-800' },
  partial: { text: 'Ready with gaps', className: 'bg-amber-50 text-amber-900' },
  ready: { text: 'Ready', className: 'bg-emerald-50 text-emerald-800' },
  failed: { text: 'Failed', className: 'bg-red-50 text-red-800' },
}

export function StatusBadge({ status }: { status: KitStatus }) {
  const { text, className } = LABELS[status]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{text}</span>
}
