export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function pluralise(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`
}

export function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${pluralise(Math.floor(seconds / 60), 'minute')} ago`
  if (seconds < 86_400) return `${pluralise(Math.floor(seconds / 3600), 'hour')} ago`
  return `${pluralise(Math.floor(seconds / 86_400), 'day')} ago`
}
