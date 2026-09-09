'use client'

import { Card } from '@/components/ui/Card'
import { RegenerateButton } from '@/components/kit/RegenerateButton'
import { pluralise } from '@/lib/format'
import { questionsForDay, totalMinutes } from '@/lib/kit-derive'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function ScheduleView({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const minutes = totalMinutes(kit)

  return (
    <Card
      title={`Study schedule — ${pluralise(kit.schedule.days_available, 'day')}`}
      actions={<RegenerateButton section="schedule" label="the schedule" mutations={mutations} state={sections.schedule} />}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {Math.round(minutes / 60)} hours across {pluralise(kit.schedule.days.length, 'day')}. Harder and required
          material is placed first, so the night before is review rather than new ground. This allocation is arithmetic
          in the application, not something the model decided.
        </p>

        <ol className="space-y-2">
          {kit.schedule.days.map((day) => {
            const questions = questionsForDay(kit, day.day)
            return (
              <li key={day.day} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Day {day.day}</h3>
                  <span className="text-xs tabular-nums text-slate-500">
                    {day.minutes} min · {pluralise(questions.length, 'question')}
                  </span>
                </div>
                <p className="mt-0.5 max-w-prose text-sm text-slate-700">{day.focus}</p>
                {questions.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {questions.map((question) => (
                      <li key={question.id} className="flex items-start gap-2 text-xs text-slate-600">
                        <code className="shrink-0 rounded bg-slate-100 px-1 py-0.5">{question.id}</code>
                        <span className="min-w-0 flex-1 truncate">{question.prompt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </Card>
  )
}
