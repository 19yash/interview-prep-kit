'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'
import { FlashcardCard } from '@/components/kit/FlashcardCard'
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
  const [draftRequirement, setDraftRequirement] = useState(kit.role.requirements[0]?.id ?? '')
  const [flippedMap, setFlippedMap] = useState<Record<string, boolean>>({})

  const requirements = requirementMap(kit)
  const willKeep = kit.flashcards.filter(survivesRegeneration).length
  const willReplace = kit.flashcards.length - willKeep
  const allFlipped = kit.flashcards.length > 0 && kit.flashcards.every((card) => flippedMap[card.id])

  function toggleFlip(id: string) {
    setFlippedMap((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleFlipAll() {
    if (allFlipped) {
      setFlippedMap({})
    } else {
      const next: Record<string, boolean> = {}
      for (const card of kit.flashcards) {
        next[card.id] = true
      }
      setFlippedMap(next)
    }
  }

  async function add() {
    if (front.trim().length === 0) return
    await mutations.addFlashcard({
      front: front.trim(),
      back: back.trim(),
      requirement_ids: draftRequirement ? [draftRequirement] : [],
    })
    setFront('')
    setBack('')
    setAdding(false)
  }

  return (
    <Card
      title={`Flashcards — ${pluralise(kit.flashcards.length, 'card')}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {kit.flashcards.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFlipAll}
                aria-label={allFlipped ? 'Flip all cards to questions' : 'Flip all cards to answers'}
              >
                {allFlipped ? 'Show all questions' : 'Flip all cards'}
              </Button>
              <Link href={`/kits/${kitId}/practice`}>
                <Button size="sm">Practise these</Button>
              </Link>
            </>
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
      <div className="space-y-4">
        {adding && (
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 via-white to-slate-50 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-indigo-950 mb-3">Add a new flashcard</h4>
            <div className="space-y-3">
              <Field label="Question" id="new-card-front" hint="What question should this card ask?">
                <input
                  id="new-card-front"
                  className={inputClass}
                  placeholder="e.g. What is the difference between synchronous and asynchronous operations?"
                  value={front}
                  onChange={(event) => setFront(event.target.value)}
                />
              </Field>
              <Field label="Answer" id="new-card-back" hint="What answer or key points should be revealed?">
                <textarea
                  id="new-card-back"
                  rows={3}
                  className={inputClass}
                  placeholder="e.g. Synchronous operations block further execution until finished, whereas asynchronous operations..."
                  value={back}
                  onChange={(event) => setBack(event.target.value)}
                />
              </Field>
              {kit.role.requirements.length > 0 && (
                <Field label="Covers requirement" id="new-card-req" hint="Optional link to a job requirement">
                  <select
                    id="new-card-req"
                    className={inputClass}
                    value={draftRequirement}
                    onChange={(event) => setDraftRequirement(event.target.value)}
                  >
                    <option value="">None / general</option>
                    {kit.role.requirements.map((req) => (
                      <option key={req.id} value={req.id}>
                        {req.id}: {req.text.slice(0, 70)}
                        {req.text.length > 70 ? '…' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" loading={mutations.busy.has('add:flashcard')} onClick={() => void add()}>
                  Add flashcard
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        {kit.flashcards.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
            <p className="text-sm font-medium text-slate-700">No flashcards yet</p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm">
              Add cards manually above, or regenerate to let the AI create targeted flashcards based on your role requirements.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                Add a card
              </Button>
              <RegenerateButton
                section="flashcards"
                label="flashcards"
                mutations={mutations}
                state={sections.flashcards}
                willReplace={willReplace}
                willKeep={willKeep}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {kit.flashcards.map((card) => (
              <FlashcardCard
                key={card.id}
                card={card}
                mutations={mutations}
                requirements={requirements}
                isFlipped={Boolean(flippedMap[card.id])}
                onToggleFlip={() => toggleFlip(card.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
