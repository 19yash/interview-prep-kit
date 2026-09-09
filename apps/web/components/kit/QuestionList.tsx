"use client";

import { useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { QuestionCard } from "@/components/kit/QuestionCard";
import { RegenerateButton } from "@/components/kit/RegenerateButton";
import {
  CATEGORY_LABELS,
  requirementMap,
  sectionKeyForCategory,
  survivesRegeneration,
} from "@/lib/kit-derive";
import { move } from "@/lib/reorder";
import { pluralise } from "@/lib/format";
import type {
  Kit,
  Question,
  QuestionCategory,
  SectionState,
} from "@/lib/types";
import type { Mutations } from "@/lib/use-kit-mutations";

function fullOrderWithCategoryReordered(
  kit: Kit,
  category: QuestionCategory,
  reordered: Question[],
): string[] {
  const queue = [...reordered];
  return kit.questions.map((question) =>
    question.category === category ? queue.shift()!.id : question.id,
  );
}

export function QuestionList({
  category,
  questions,
  kit,
  mutations,
  sections,
}: {
  category: QuestionCategory;
  questions: Question[];
  kit: Kit;
  mutations: Mutations;
  sections: Record<string, SectionState>;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftRequirement, setDraftRequirement] = useState(
    kit.role.requirements[0]?.id ?? "",
  );

  const requirements = requirementMap(kit);
  const section = sectionKeyForCategory(category);
  const willKeep = questions.filter(survivesRegeneration).length;
  const willReplace = questions.length - willKeep;

  /**
   * Reordering within a category is expressed as a reorder of the whole bank:
   * the server validates the full id set, which makes a partial or stale list
   * impossible to apply.
   */
  function reorderWithin(from: number, to: number) {
    const reordered = move(questions, from, to);
    const ordered = fullOrderWithCategoryReordered(kit, category, reordered);
    void mutations.reorderQuestions(ordered);
  }

  function onDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    reorderWithin(dragIndex, index);
    setDragIndex(null);
  }

  async function addQuestion() {
    const prompt = draft.trim();
    if (prompt.length === 0) return;
    await mutations.addQuestion({
      category,
      prompt,
      requirement_ids: draftRequirement ? [draftRequirement] : [],
      difficulty: 2,
    });
    setDraft("");
    setAdding(false);
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            {CATEGORY_LABELS[category]}
          </h3>
          <p className="text-xs text-slate-500">
            {pluralise(questions.length, "question")}
            {willKeep > 0 && ` · ${willKeep} yours`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!adding && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding(true)}
            >
              Add a question
            </Button>
          )}
          <RegenerateButton
            section={section}
            label={CATEGORY_LABELS[category].toLowerCase()}
            mutations={mutations}
            state={sections[section]}
            willReplace={willReplace}
            willKeep={willKeep}
          />
        </div>
      </header>

      {adding && (
        <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
          <Field label="New question" id={`new-${category}`}>
            <textarea
              id={`new-${category}`}
              rows={3}
              className={inputClass}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="What would you want to be asked?"
            />
          </Field>
          {kit.role.requirements.length > 0 && (
            <Field
              label="Covers requirement"
              id={`req-${category}`}
              hint="Linking it means the coverage check counts it."
            >
              <select
                id={`req-${category}`}
                className={inputClass}
                value={draftRequirement}
                onChange={(event) => setDraftRequirement(event.target.value)}
              >
                {kit.role.requirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.id} — {requirement.text}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={mutations.busy.has(`add:${category}`)}
              onClick={() => void addQuestion()}
            >
              Add question
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {questions.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-3 py-4 text-sm text-slate-600">
          No {CATEGORY_LABELS[category].toLowerCase()} questions. Add one by
          hand, or regenerate this category.
        </p>
      ) : (
        <ul className="space-y-2">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              requirements={requirements}
              mutations={mutations}
              index={index}
              count={questions.length}
              onMoveWithin={reorderWithin}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, index)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
