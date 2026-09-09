'use client'

import { useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { EditableText } from '@/components/kit/EditableText'
import { OriginBadge } from '@/components/kit/OriginBadge'
import { CATEGORY_LABELS, CATEGORY_ORDER, survivesRegeneration } from '@/lib/kit-derive'
import type { Question, QuestionCategory, Requirement } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function QuestionCard({
  question,
  requirements,
  mutations,
  index,
  count,
  onMoveWithin,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  question: Question
  requirements: Map<string, Requirement>
  mutations: Mutations
  index: number
  count: number
  onMoveWithin: (from: number, to: number) => void
  onDragStart: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const busy = mutations.busy.has(`question:${question.id}`)
  const safe = survivesRegeneration(question)

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`rounded-md border p-3 ${safe ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-200 bg-white'} ${busy ? 'opacity-70' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="cursor-grab select-none text-slate-400" title="Drag to reorder">
            ⠿
          </span>
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{question.id}</code>
          <OriginBadge origin={question.origin} pinned={question.pinned} />
        </div>

        <div className="flex items-center gap-1">
          {/* The keyboard route to reordering. Drag is an addition, not the only way. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => onMoveWithin(index, index - 1)}
            aria-label={`Move ${question.id} earlier`}
          >
            <span aria-hidden="true">↑</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={index === count - 1}
            onClick={() => onMoveWithin(index, index + 1)}
            aria-label={`Move ${question.id} later`}
          >
            <span aria-hidden="true">↓</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void mutations.pinQuestion(question.id, !question.pinned)}
            aria-pressed={question.pinned}
            aria-label={question.pinned ? `Unpin ${question.id}` : `Pin ${question.id}`}
          >
            {question.pinned ? 'Unpin' : 'Pin'}
          </Button>
          {confirmingDelete ? (
            <>
              <Button variant="danger" size="sm" onClick={() => void mutations.deleteQuestion(question.id)}>
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)} aria-label={`Delete ${question.id}`}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 max-w-prose space-y-2">
        <EditableText
          label={`Question ${question.id}`}
          value={question.prompt}
          multiline
          required
          busy={busy}
          className="font-medium leading-relaxed"
          onCommit={(prompt) => void mutations.editQuestion(question.id, { prompt })}
        />
        <div>
          <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Answer outline</span>
          <EditableText
            label={`Answer outline for ${question.id}`}
            value={question.answer_outline}
            multiline
            busy={busy}
            placeholder="What a strong answer covers…"
            className="leading-relaxed text-slate-700"
            onCommit={(answer_outline) => void mutations.editQuestion(question.id, { answer_outline })}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5 text-slate-600">
          Difficulty
          <select
            value={question.difficulty}
            disabled={busy}
            onChange={(event) => void mutations.editQuestion(question.id, { difficulty: Number(event.target.value) as 1 | 2 | 3 })}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            aria-label={`Difficulty for ${question.id}`}
          >
            <option value={1}>1 — warm-up</option>
            <option value={2}>2 — standard</option>
            <option value={3}>3 — stretch</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-slate-600">
          Category
          <select
            value={question.category}
            disabled={busy}
            onChange={(event) => void mutations.moveQuestionToCategory(question.id, event.target.value as QuestionCategory)}
            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            aria-label={`Category for ${question.id}`}
          >
            {CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>

        <span className="flex flex-wrap items-center gap-1 text-slate-500">
          Covers
          {question.requirement_ids.length === 0 ? (
            <span className="text-amber-700">nothing — this counts against no requirement</span>
          ) : (
            question.requirement_ids.map((id) => (
              <code key={id} className="rounded bg-slate-100 px-1 py-0.5" title={requirements.get(id)?.text ?? 'unknown requirement'}>
                {id}
              </code>
            ))
          )}
        </span>
      </div>
    </li>
  )
}
