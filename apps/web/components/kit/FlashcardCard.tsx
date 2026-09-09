'use client'

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { OriginBadge } from '@/components/kit/OriginBadge'
import { survivesRegeneration } from '@/lib/kit-derive'
import type { Flashcard, Requirement } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function FlashcardCard({
  card,
  mutations,
  requirements,
  isFlipped,
  onToggleFlip,
}: {
  card: Flashcard
  mutations: Mutations
  requirements: Map<string, Requirement>
  isFlipped: boolean
  onToggleFlip: () => void
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [isEditingFront, setIsEditingFront] = useState(false)
  const [isEditingBack, setIsEditingBack] = useState(false)
  const [draftFront, setDraftFront] = useState(card.front)
  const [draftBack, setDraftBack] = useState(card.back)

  const busy = mutations.busy.has(`flashcard:${card.id}`)
  const safe = survivesRegeneration(card)

  useEffect(() => {
    if (!isEditingFront) setDraftFront(card.front)
  }, [card.front, isEditingFront])

  useEffect(() => {
    if (!isEditingBack) setDraftBack(card.back)
  }, [card.back, isEditingBack])

  function handleCardClick(event: MouseEvent) {
    if (isEditingFront || isEditingBack) return
    const target = event.target as HTMLElement
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('a') ||
      target.closest('[contenteditable="true"]')
    ) {
      return
    }
    onToggleFlip()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (isEditingFront || isEditingBack) return
    const target = event.target as HTMLElement
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('a')
    ) {
      return
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      onToggleFlip()
    }
  }

  async function saveFront() {
    const next = draftFront.trim()
    if (next.length === 0) return
    setIsEditingFront(false)
    if (next !== card.front) {
      await mutations.editFlashcard(card.id, { front: next })
    }
  }

  async function saveBack() {
    const next = draftBack.trim()
    setIsEditingBack(false)
    if (next !== card.back) {
      await mutations.editFlashcard(card.id, { back: next })
    }
  }

  return (
    <div
      className={`group perspective-1000 h-[310px] w-full select-none ${busy ? 'opacity-70' : ''}`}
      tabIndex={isEditingFront || isEditingBack ? -1 : 0}
      role="button"
      aria-label={`Flashcard ${card.id}: showing ${isFlipped ? 'answer' : 'question'}. Press Space or Enter to flip.`}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`relative h-full w-full rounded-2xl transform-style-3d transition-transform duration-500 ease-out ${
          isFlipped ? 'rotate-y-180' : ''
        }`}
      >
        {/* FRONT FACE (Question) */}
        <div
          onClick={handleCardClick}
          className={`absolute inset-0 flex flex-col justify-between rounded-2xl border p-4 sm:p-5 backface-hidden shadow-sm transition-all duration-200 hover:shadow-md cursor-pointer ${
            safe
              ? 'border-indigo-200/90 bg-gradient-to-b from-white via-indigo-50/10 to-indigo-50/20'
              : 'border-slate-200/90 bg-gradient-to-b from-white to-slate-50/50'
          }`}
        >
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                {card.id}
              </span>
              <OriginBadge origin={card.origin} pinned={card.pinned} />
              {card.requirement_ids.map((id) => (
                <span
                  key={id}
                  className="rounded-md bg-slate-100/90 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                  title={requirements.get(id)?.text ?? 'unknown requirement'}
                >
                  {id}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={card.pinned}
                onClick={() => void mutations.pinFlashcard(card.id, !card.pinned)}
                aria-label={card.pinned ? `Unpin ${card.id}` : `Pin ${card.id}`}
              >
                {card.pinned ? 'Unpin' : 'Pin'}
              </Button>
              {!isEditingFront && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingFront(true)}
                  aria-label={`Edit question for ${card.id}`}
                >
                  Edit
                </Button>
              )}
              {confirmingId === card.id ? (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void mutations.deleteFlashcard(card.id)}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingId(card.id)}
                  aria-label={`Delete ${card.id}`}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>

          {/* Body: Question */}
          {isEditingFront ? (
            <div className="flex flex-1 flex-col py-2" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                  Edit Question
                </span>
                <span className="text-[11px] text-slate-400">⌘+Enter to save</span>
              </div>
              <textarea
                autoFocus
                value={draftFront}
                onChange={(e) => setDraftFront(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setIsEditingFront(false)
                    setDraftFront(card.front)
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void saveFront()
                  }
                }}
                className="w-full flex-1 resize-none rounded-xl border border-indigo-300 bg-white p-2.5 text-base font-medium leading-relaxed text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Enter question prompt..."
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setIsEditingFront(false); setDraftFront(card.front); }}>
                  Cancel
                </Button>
                <Button size="sm" loading={busy} onClick={() => void saveFront()}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="flex flex-1 flex-col justify-start overflow-y-auto py-2.5"
              onDoubleClick={() => setIsEditingFront(true)}
              title="Double click to edit"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                  Question
                </span>
              </div>
              <p className="select-text text-base font-medium leading-relaxed text-slate-900 break-words whitespace-pre-wrap">
                {card.front}
              </p>
            </div>
          )}

          {/* Footer */}
          {!isEditingFront && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
              <span className="flex items-center gap-1 font-medium text-slate-400">
                <span>Click card to reveal answer</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFlip()
                }}
                className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                aria-label={`Flip ${card.id} to view answer`}
              >
                <span>Reveal answer</span>
                <span aria-hidden="true">↻</span>
              </button>
            </div>
          )}
        </div>

        {/* BACK FACE (Answer) */}
        <div
          onClick={handleCardClick}
          className="absolute inset-0 flex flex-col justify-between rounded-2xl border border-indigo-200/90 bg-gradient-to-b from-indigo-50/40 via-white to-slate-50 p-4 sm:p-5 backface-hidden rotate-y-180 shadow-sm transition-all duration-200 hover:shadow-md cursor-pointer"
        >
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100/70 pb-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-indigo-100 px-2 py-0.5 font-mono text-xs font-semibold text-indigo-800">
                {card.id}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 border border-emerald-200/60">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Answer
              </span>
            </div>

            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={card.pinned}
                onClick={() => void mutations.pinFlashcard(card.id, !card.pinned)}
                aria-label={card.pinned ? `Unpin ${card.id}` : `Pin ${card.id}`}
              >
                {card.pinned ? 'Unpin' : 'Pin'}
              </Button>
              {!isEditingBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingBack(true)}
                  aria-label={`Edit answer for ${card.id}`}
                >
                  Edit
                </Button>
              )}
              {confirmingId === card.id ? (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void mutations.deleteFlashcard(card.id)}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingId(card.id)}
                  aria-label={`Delete ${card.id}`}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>

          {/* Body: Answer */}
          {isEditingBack ? (
            <div className="flex flex-1 flex-col py-2" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                  Edit Answer
                </span>
                <span className="text-[11px] text-slate-400">⌘+Enter to save</span>
              </div>
              <textarea
                autoFocus
                value={draftBack}
                onChange={(e) => setDraftBack(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setIsEditingBack(false)
                    setDraftBack(card.back)
                  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void saveBack()
                  }
                }}
                className="w-full flex-1 resize-none rounded-xl border border-indigo-300 bg-white p-2.5 text-sm leading-relaxed text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                placeholder="Enter answer..."
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setIsEditingBack(false); setDraftBack(card.back); }}>
                  Cancel
                </Button>
                <Button size="sm" loading={busy} onClick={() => void saveBack()}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="flex flex-1 flex-col justify-start overflow-y-auto py-2.5"
              onDoubleClick={() => setIsEditingBack(true)}
              title="Double click to edit"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                  Answer
                </span>
              </div>
              <p className="select-text text-sm sm:text-base leading-relaxed text-slate-800 break-words whitespace-pre-wrap">
                {card.back || <span className="italic text-slate-400">No answer written yet.</span>}
              </p>
            </div>
          )}

          {/* Footer */}
          {!isEditingBack && (
            <div className="flex items-center justify-between border-t border-indigo-100/70 pt-2.5 text-xs text-slate-500">
              <span className="flex items-center gap-1 font-medium text-slate-400">
                <span>Click card to return</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFlip()
                }}
                className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                aria-label={`Flip ${card.id} back to question`}
              >
                <span>Show question</span>
                <span aria-hidden="true">↺</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
