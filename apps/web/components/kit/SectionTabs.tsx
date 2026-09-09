'use client'

import { useRef, type KeyboardEvent } from 'react'

/**
 * Roving-tabindex tablist: arrow keys move between tabs, which is what a
 * keyboard user expects and what a row of plain buttons does not give them.
 */
export function SectionTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; badge?: string }[]
  active: string
  onChange: (id: string) => void
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.id === active)
    if (index < 0) return
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]!
    onChange(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div role="tablist" aria-label="Kit sections" onKeyDown={onKeyDown} className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[tab.id] = element
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`-mb-px rounded-t border-b-2 px-3 py-2 text-sm font-medium ${
              selected ? 'border-indigo-600 text-indigo-800' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
            {tab.badge && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{tab.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
