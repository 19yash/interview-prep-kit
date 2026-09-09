'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { ProgressPanel } from '@/components/progress/ProgressPanel'
import { WarningList } from '@/components/progress/WarningList'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { pluralise } from '@/lib/format'
import { useKit } from '@/lib/use-kit'

function KitView({ id }: { id: string }) {
  const { doc, error, loading, refresh } = useKit(id)

  if (loading) return <StateBlock state="loading" title="Loading this kit" />
  if (error || !doc) {
    return (
      <StateBlock
        state="error"
        title="Could not load this kit"
        detail={error ?? 'it may have been deleted'}
        action={
          <Link href="/kits">
            <Button variant="secondary">Back to my kits</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {doc.kit?.role.title ?? 'Building your kit'}
          </h1>
          <p className="text-sm text-slate-600">
            {doc.kit?.source.company ?? doc.input.companyUrl} · {pluralise(doc.input.days, 'day')} to prepare
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {doc.status === 'failed' && (
        <StateBlock
          state="error"
          title="This kit could not be generated"
          detail={doc.error?.message ?? 'the run failed before a kit could be produced'}
          action={
            <Link href="/kits/new">
              <Button variant="secondary">Start another</Button>
            </Link>
          }
        />
      )}

      {(doc.status === 'queued' || doc.status === 'running') && (
        <Card title="Progress">
          <ProgressPanel progress={doc.progress} status={doc.status} />
          <p className="mt-4 max-w-prose text-xs text-slate-500">
            This usually takes a minute or two. You can leave this page — generation continues, and the kit will be
            waiting in your list.
          </p>
        </Card>
      )}

      {doc.kit && (
        <>
          <WarningList warnings={doc.kit.warnings} />

          <Card
            title="Kit summary"
            actions={
              <Button variant="secondary" size="sm" onClick={() => void refresh()}>
                Refresh
              </Button>
            }
          >
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Requirements</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{doc.kit.role.requirements.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Questions</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{doc.kit.questions.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Flashcards</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{doc.kit.flashcards.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Uncovered</dt>
                <dd
                  className={`mt-0.5 text-lg font-semibold tabular-nums ${doc.kit.coverage.uncovered_requirement_ids.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}
                >
                  {doc.kit.coverage.uncovered_requirement_ids.length}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-slate-500">
              Coverage was checked over {pluralise(doc.kit.coverage.passes, 'pass', 'passes')}. The reader and the
              builder arrive in the next phase.
            </p>
          </Card>

          <Card title="Sources used">
            {doc.kit.source.pages_used.length === 0 ? (
              <p className="text-sm text-slate-600">
                Nothing could be retrieved from this company&apos;s site, so the kit was built from the job description
                alone.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {doc.kit.source.pages_used.map((url) => (
                  <li key={url} className="truncate">
                    <a href={url} target="_blank" rel="noreferrer noopener" className="rounded text-indigo-700 hover:underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default function KitPage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <KitView id={params.id} />
    </RequireAuth>
  )
}
