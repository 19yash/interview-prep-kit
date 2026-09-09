'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'
import { EditableText } from '@/components/kit/EditableText'
import { OriginBadge } from '@/components/kit/OriginBadge'
import { RegenerateButton } from '@/components/kit/RegenerateButton'
import { pluralise } from '@/lib/format'
import { requirementMap, survivesRegeneration } from '@/lib/kit-derive'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function FlashcardList({
  kitId,
  kit,
  mutations,
  sections,
}: {
  kitId: string
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const [adding, setAdding] = useState(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const requirements = requirementMap(kit)

  const willKeep = kit.flashcards.filter(survivesRegeneration).length
  const willReplace = kit.flashcards.length - willKeep

  async function add() {
    if (front.trim().length === 0) return
    await mutations.addFlashcard({ front: front.trim(), back: back.trim(), requirement_ids: kit.role.requirements[0] ? [kit.role.requirements[0].id] : [] })
    setFront('')
    setBack('')
    setAdding(false)
  }

  return (
    <Card
      title={`Flashcards — ${pluralise(kit.flashcards.length, 'card')}`}
      actions={
        <div className="flex items-center gap-2">
          {kit.flashcards.length > 0 && (
            <Link href={`/kits/${kitId}/practice`}>
              <Button size="sm">Practise these</Button>
            </Link>
          )}
          {!adding && (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              Add a flashcard
            </Button>
          )}
          <RegenerateButton
            section="flashcards"
            label="flashcards"
            mutations={mutations}
            state={sections.flashcards}
            willReplace={willReplace}
            willKeep={willKeep}
          />
        </div>
      }
    >
      <div className="space-y-3">
        {adding && (
          <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
            <Field label="Front" id="new-card-front">
              <input id="new-card-front" className={inputClass} value={front} onChange={(event) => setFront(event.target.value)} />
            </Field>
            <Field label="Back" id="new-card-back">
              <textarea id="new-card-back" rows={2} className={inputClass} value={back} onChange={(event) => setBack(event.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" loading={mutations.busy.has('add:flashcard')} onClick={() => void add()}>
                Add card
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {kit.flashcards.length === 0 ? (
          <p className="rounded-md bg-slate-50 px-3 py-4 text-sm text-slate-600">
            No flashcards yet. Add one by hand above, or regenerate flashcards.
          </p>
        ) : (
          <ul className="space-y-2">
            {kit.flashcards.map((card) => {
              const busy = mutations.busy.has(`flashcard:${card.id}`)
              const safe = survivesRegeneration(card)
              return (
                <li
                  key={card.id}
                  className={`rounded-md border p-3 ${safe ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-white'} ${busy ? 'opacity-70' : ''}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{card.id}</code>
                      <OriginBadge origin={card.origin} pinned={card.pinned} />
                      {card.requirement_ids.map((id) => (
                        <code
                          key={id}
                          className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-600"
                          title={requirements.get(id)?.text ?? 'unknown requirement'}
                        >
                          {id}
                        </code>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={card.pinned}
                        onClick={() => void mutations.pinFlashcard(card.id, !card.pinned)}
                        aria-label={card.pinned ? `Unpin ${card.id}` : `Pin ${card.id}`}
                      >
                        {card.pinned ? 'Unpin' : 'Pin'}
                      </Button>
                      {confirmingId === card.id ? (
                        <>
                          <Button variant="danger" size="sm" onClick={() => void mutations.deleteFlashcard(card.id)}>
                            Delete
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmingId(card.id)} aria-label={`Delete ${card.id}`}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Front</span>
                      <EditableText
                        label={`Front of ${card.id}`}
                        value={card.front}
                        multiline
                        required
                        busy={busy}
                        onCommit={(next) => void mutations.editFlashcard(card.id, { front: next })}
                      />
                    </div>
                    <div>
                      <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Back</span>
                      <EditableText
                        label={`Back of ${card.id}`}
                        value={card.back}
                        multiline
                        busy={busy}
                        onCommit={(next) => void mutations.editFlashcard(card.id, { back: next })}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
