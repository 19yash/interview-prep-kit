'use client'

import { useCallback, useMemo, useState } from 'react'
import { api, ApiError } from './api'
import type { Flashcard, Kit, KitDoc, Question, QuestionCategory } from './types'

type Patch<T> = Partial<T>

function withKit(doc: KitDoc, mutate: (kit: Kit) => void): KitDoc {
  if (!doc.kit) return doc
  const next = structuredClone(doc) as KitDoc
  mutate(next.kit!)
  return next
}

/**
 * Every write in the builder. The pattern is the same throughout: apply the
 * change to a clone at once so typing and dragging feel local, send one request
 * for that one item, then replace the document with the one the server
 * returns — which carries effects the client should not try to recompute, such
 * as a recalculated coverage set or a schedule with a deleted question pruned
 * out of it. A failure restores the document exactly as it was and surfaces the
 * server's own sentence.
 */
export function useKitMutations({
  doc,
  setDoc,
  refresh,
  client = api,
}: {
  doc: KitDoc
  setDoc: (doc: KitDoc) => void
  refresh: () => Promise<void>
  client?: typeof api
}) {
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const mark = useCallback((key: string, on: boolean) => {
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /** The shared envelope: optimistic apply, request, reconcile or roll back. */
  const run = useCallback(
    async (key: string, optimistic: KitDoc, request: () => Promise<KitDoc | void>, refetch = false) => {
      const previous = doc
      setError(null)
      mark(key, true)
      setDoc(optimistic)
      try {
        const returned = await request()
        if (returned) setDoc(returned)
        else if (refetch) await refresh()
      } catch (caught) {
        setDoc(previous)
        setError(caught instanceof ApiError ? caught.message : 'that change could not be saved')
      } finally {
        mark(key, false)
      }
    },
    [doc, setDoc, refresh, mark],
  )

  return useMemo(() => {
    const kitId = doc.id

    return {
      busy,
      error,
      clearError: () => setError(null),

      editQuestion: (id: string, patch: Patch<Pick<Question, 'prompt' | 'answer_outline' | 'difficulty'>>) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            const question = kit.questions.find((item) => item.id === id)
            if (!question) return
            Object.assign(question, patch)
            // Mirrors the server rule: an edit takes the item out of reach of
            // any future regeneration of its category.
            question.origin = question.origin === 'manual' ? 'manual' : 'edited'
            question.rev += 1
          }),
          () => client.patchQuestion(kitId, id, patch),
        ),

      pinQuestion: (id: string, pinned: boolean) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            const question = kit.questions.find((item) => item.id === id)
            if (question) question.pinned = pinned
          }),
          () => client.patchQuestion(kitId, id, { pinned }),
        ),

      addQuestion: async (input: {
        category: QuestionCategory
        prompt: string
        answer_outline?: string
        requirement_ids?: string[]
        difficulty?: number
      }) => {
        // No optimistic id: the server assigns it, and inventing one locally
        // would risk colliding with an id it later hands out.
        setError(null)
        mark(`add:${input.category}`, true)
        try {
          const { kit } = await client.addQuestion(kitId, input)
          setDoc(kit)
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : 'that question could not be added')
        } finally {
          mark(`add:${input.category}`, false)
        }
      },

      deleteQuestion: (id: string) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            kit.questions = kit.questions.filter((item) => item.id !== id)
            kit.schedule.days = kit.schedule.days.map((day) => ({
              ...day,
              question_ids: day.question_ids.filter((qid) => qid !== id),
            }))
          }),
          () => client.deleteQuestion(kitId, id),
          true,
        ),

      moveQuestionToCategory: (id: string, category: QuestionCategory) =>
        run(
          `question:${id}`,
          withKit(doc, (kit) => {
            const question = kit.questions.find((item) => item.id === id)
            if (!question) return
            question.category = category
            if (question.origin === 'generated') question.origin = 'edited'
            question.rev += 1
          }),
          () => client.moveQuestion(kitId, id, category),
        ),

      reorderQuestions: (ids: string[]) =>
        run(
          'order:questions',
          withKit(doc, (kit) => {
            const byId = new Map(kit.questions.map((question) => [question.id, question]))
            kit.questions = ids
              .map((id) => byId.get(id))
              .filter((question): question is Question => question !== undefined)
          }),
          () => client.reorderQuestions(kitId, ids),
        ),

      editFlashcard: (id: string, patch: Patch<Pick<Flashcard, 'front' | 'back'>>) =>
        run(
          `flashcard:${id}`,
          withKit(doc, (kit) => {
            const card = kit.flashcards.find((item) => item.id === id)
            if (!card) return
            Object.assign(card, patch)
            card.origin = card.origin === 'manual' ? 'manual' : 'edited'
            card.rev += 1
          }),
          () => client.patchFlashcard(kitId, id, patch),
        ),

      pinFlashcard: (id: string, pinned: boolean) =>
        run(
          `flashcard:${id}`,
          withKit(doc, (kit) => {
            const card = kit.flashcards.find((item) => item.id === id)
            if (card) card.pinned = pinned
          }),
          () => client.patchFlashcard(kitId, id, { pinned }),
        ),

      addFlashcard: async (input: { front: string; back?: string; requirement_ids?: string[] }) => {
        setError(null)
        mark('add:flashcard', true)
        try {
          const { kit } = await client.addFlashcard(kitId, input)
          setDoc(kit)
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : 'that flashcard could not be added')
        } finally {
          mark('add:flashcard', false)
        }
      },

      deleteFlashcard: (id: string) =>
        run(
          `flashcard:${id}`,
          withKit(doc, (kit) => {
            kit.flashcards = kit.flashcards.filter((item) => item.id !== id)
          }),
          () => client.deleteFlashcard(kitId, id),
          true,
        ),

      editBrief: (patch: { summary?: string; what_they_do?: string }) =>
        run(
          'brief',
          withKit(doc, (kit) => {
            Object.assign(kit.company_brief, patch)
          }),
          () => client.patchBrief(kitId, patch),
        ),

      regenerate: (section: string) => {
        // The kit itself is untouched optimistically: the point of a
        // regeneration is that the old content stays readable until the new
        // content has arrived and validated.
        const optimistic: KitDoc = {
          ...doc,
          sections: {
            ...doc.sections,
            [section]: { status: 'regenerating', rev: doc.sections[section]?.rev ?? 0, error: null },
          },
        }
        return run(`section:${section}`, optimistic, () => client.regenerate(kitId, section))
      },
    }
  }, [doc, busy, error, run, mark, setDoc, client])
}

export type Mutations = ReturnType<typeof useKitMutations>
