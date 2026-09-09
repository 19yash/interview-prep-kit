export function Spinner({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span
        className={`${dimension} animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600`}
        aria-hidden="true"
      />
      {/* The label is the accessible name; a bare spinner announces nothing. */}
      <span role="status">{label}</span>
    </span>
  )
}
