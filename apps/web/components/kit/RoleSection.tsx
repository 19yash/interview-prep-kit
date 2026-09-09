import { Card } from '@/components/ui/Card'
import { pluralise } from '@/lib/format'
import type { Kit } from '@/lib/types'

const KIND_LABELS = { technical: 'Technical', behavioural: 'Behavioural', domain: 'Domain' } as const

/**
 * Read-only. Requirements are the spine of the kit — every question and
 * flashcard references them by id — so editing them here would silently
 * invalidate those references. Reshaping happens on the questions instead.
 */
export function RoleSection({ kit }: { kit: Kit }) {
  const musts = kit.role.requirements.filter((requirement) => requirement.priority === 'must')

  return (
    <Card title="The role">
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-slate-900">{kit.role.title}</h3>
          <span className="text-sm text-slate-600">{kit.role.seniority}</span>
          {kit.source.location && <span className="text-sm text-slate-500">· {kit.source.location}</span>}
        </div>

        {kit.role.responsibilities.length > 0 && (
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Responsibilities</h4>
            <ul className="mt-1.5 max-w-prose list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-800">
              {kit.role.responsibilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Requirements — {pluralise(musts.length, 'must-have')} of {kit.role.requirements.length}
          </h4>
          {kit.role.requirements.length === 0 ? (
            <p className="mt-1.5 max-w-prose text-sm text-slate-600">
              No requirements could be extracted from this description. That usually means the posting was very thin —
              the kit reflects that rather than inventing any.
            </p>
          ) : (
            <ul className="mt-1.5 divide-y divide-slate-100">
              {kit.role.requirements.map((requirement) => {
                const uncovered = kit.coverage.uncovered_requirement_ids.includes(requirement.id)
                return (
                  <li key={requirement.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
                    <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{requirement.id}</code>
                    <span className="min-w-0 flex-1 text-slate-800">{requirement.text}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        requirement.priority === 'must' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {requirement.priority === 'must' ? 'Must' : 'Nice'}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">{KIND_LABELS[requirement.kind]}</span>
                    {uncovered && (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                        No question yet
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
