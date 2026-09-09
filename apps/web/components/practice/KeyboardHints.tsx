const HINTS = [
  { keys: 'Space', action: 'reveal the answer' },
  { keys: '1 / 2 / 3', action: 'rate your confidence' },
  { keys: '→', action: 'skip without rating' },
  { keys: '←', action: 'go back' },
]

export function KeyboardHints() {
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {HINTS.map((hint) => (
        <div key={hint.keys} className="flex items-center gap-1.5">
          <dt>
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[11px] text-slate-700">{hint.keys}</kbd>
          </dt>
          <dd>{hint.action}</dd>
        </div>
      ))}
    </dl>
  )
}
