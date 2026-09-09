'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Local while typing, one request on commit. Nothing is sent per keystroke,
 * and nothing is sent at all if the value has not changed — which keeps a
 * stray focus-and-blur from bumping an item's revision and quietly marking it
 * as edited.
 */
export function EditableText({
  value,
  onCommit,
  label,
  multiline = false,
  placeholder,
  busy = false,
  required = false,
  className = '',
}: {
  value: string
  onCommit: (next: string) => void
  label: string
  multiline?: boolean
  placeholder?: string
  busy?: boolean
  required?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  // A regeneration or another client's change can replace the value underneath
  // an idle field; adopt it, but never while the user is mid-edit.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  function commit() {
    setEditing(false)
    const next = draft.trim()
    if (required && next.length === 0) {
      setLocalError(`${label} cannot be empty`)
      setDraft(value)
      return
    }
    setLocalError(null)
    if (next === value.trim()) return
    onCommit(next)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
    setLocalError(null)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    // Enter commits a single line; a textarea needs a modifier so newlines work.
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }

  const shared = {
    ref: ref as never,
    value: draft,
    placeholder,
    'aria-label': label,
    'aria-invalid': localError ? true : undefined,
    disabled: busy,
    onFocus: () => setEditing(true),
    onBlur: commit,
    onKeyDown,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    className: `w-full rounded-md border bg-white px-2 py-1.5 text-sm text-slate-900 ${
      localError ? 'border-red-300' : editing ? 'border-indigo-400' : 'border-transparent hover:border-slate-300'
    } ${busy ? 'opacity-60' : ''} ${className}`,
  }

  return (
    <div className="space-y-1">
      {multiline ? <textarea {...shared} rows={Math.min(10, Math.max(2, draft.split('\n').length + 1))} /> : <input {...shared} />}
      {editing && (
        <p className="px-2 text-[11px] text-slate-400">
          {multiline ? '⌘/Ctrl+Enter' : 'Enter'} to save · Escape to cancel
        </p>
      )}
      {localError && (
        <p role="alert" className="px-2 text-xs font-medium text-red-700">
          {localError}
        </p>
      )}
    </div>
  )
}
