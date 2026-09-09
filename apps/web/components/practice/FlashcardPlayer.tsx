'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfidenceButtons } from '@/components/practice/ConfidenceButtons'
import { KeyboardHints } from '@/components/practice/KeyboardHints'
import { SessionProgress } from '@/components/practice/SessionProgress'
import type { PracticeSession } from '@/lib/use-practice'

export function FlashcardPlayer({ session, deckSize }: { session: PracticeSession; deckSize: number }) {
  const { card, revealed, reveal, rate, next, previous, saving, error, index, queue, covered, ratedThisSession } = session

  /**
   * Keyboard first: the whole session is operable without a pointer. Handlers
   * are skipped while focus is in a form control so the shortcuts never eat
   * someone's typing.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
      if (!card) return

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (!revealed) reveal()
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
        return
      }
      if (['1', '2', '3'].includes(event.key)) {
        event.preventDefault()
        if (!revealed) reveal()
        else void rate(Number(event.key) as 1 | 2 | 3)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [card, revealed, reveal, rate, next, previous])

  if (!card) return null

  return (
    <div className="space-y-4">
      <SessionProgress index={index} total={queue.length} covered={covered.length} deck={deckSize} />

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error} — your place has been kept, try rating again.
        </p>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Question</p>
        <p className="mt-2 max-w-prose text-lg font-medium leading-relaxed text-slate-900">{card.front}</p>

        {/* aria-live so a screen reader announces the answer when it appears
            rather than leaving it silently in the page. */}
        <div className="mt-6 border-t border-slate-100 pt-6" aria-live="polite">
          {revealed ? (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Answer</p>
              <p className="mt-2 max-w-prose leading-relaxed text-slate-800">{card.back || 'This card has no answer written yet.'}</p>
            </>
          ) : (
            <Button onClick={reveal} variant="secondary">
              Reveal the answer
            </Button>
          )}
        </div>
      </div>

      {revealed && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">How confident did you feel?</p>
          <ConfidenceButtons onRate={(confidence) => void rate(confidence)} disabled={saving} current={ratedThisSession.get(card.id)} />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={previous} disabled={index === 0}>
          ← Back
        </Button>
        <Button variant="ghost" size="sm" onClick={next}>
          Skip without rating →
        </Button>
      </div>

      <KeyboardHints />
    </div>
  )
}
