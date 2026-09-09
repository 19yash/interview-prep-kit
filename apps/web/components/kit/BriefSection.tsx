'use client'

import { Card } from '@/components/ui/Card'
import { EditableText } from '@/components/kit/EditableText'
import { RegenerateButton } from '@/components/kit/RegenerateButton'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function BriefSection({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const busy = mutations.busy.has('brief')
  const nothingFound = kit.company_brief.sources.length === 0

  return (
    <Card
      title="Company brief"
      actions={<RegenerateButton section="company_brief" label="the brief" mutations={mutations} state={sections.company_brief} />}
    >
      <div className="max-w-prose space-y-4">
        {nothingFound && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nothing could be retrieved about this company, so this brief is honest about that rather than filled in.
          </p>
        )}

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Summary</h3>
          <EditableText
            label="Company summary"
            value={kit.company_brief.summary}
            multiline
            required
            busy={busy}
            className="mt-1 leading-relaxed"
            onCommit={(summary) => void mutations.editBrief({ summary })}
          />
        </div>

        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">What they do</h3>
          <EditableText
            label="What they do"
            value={kit.company_brief.what_they_do}
            multiline
            required
            busy={busy}
            className="mt-1 leading-relaxed"
            onCommit={(what_they_do) => void mutations.editBrief({ what_they_do })}
          />
        </div>

        {kit.company_brief.sources.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Sources</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {kit.company_brief.sources.map((url) => (
                <li key={url} className="truncate">
                  <a href={url} target="_blank" rel="noreferrer noopener" className="rounded text-indigo-700 hover:underline">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
