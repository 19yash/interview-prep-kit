'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { BriefSection } from '@/components/kit/BriefSection'
import { FlashcardList } from '@/components/kit/FlashcardList'
import { QuestionBank } from '@/components/kit/QuestionBank'
import { RoleSection } from '@/components/kit/RoleSection'
import { ScheduleView } from '@/components/kit/ScheduleView'
import { SectionTabs } from '@/components/kit/SectionTabs'
import { ProgressPanel } from '@/components/progress/ProgressPanel'
import { WarningList } from '@/components/progress/WarningList'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { pluralise } from '@/lib/format'
import type { KitDoc } from '@/lib/types'
import { useKit } from '@/lib/use-kit'
import { useKitMutations } from '@/lib/use-kit-mutations'

function KitBuilder({
  doc,
  setDoc,
  refresh,
}: {
  doc: KitDoc
  setDoc: (doc: KitDoc) => void
  refresh: () => Promise<void>
}) {
  const mutations = useKitMutations({ doc, setDoc, refresh })
  const [tab, setTab] = useState('overview')
  const kit = doc.kit

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{kit?.role.title ?? 'Building your kit'}</h1>
          <p className="text-sm text-slate-600">
            {kit?.source.company ?? doc.input.companyUrl} · {pluralise(doc.input.days, 'day')} to prepare
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

      {mutations.error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{mutations.error}</span>
          <button type="button" onClick={mutations.clearError} className="rounded font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {kit && (
        <>
          <WarningList warnings={kit.warnings} />

          <SectionTabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'questions', label: 'Questions', badge: String(kit.questions.length) },
              { id: 'flashcards', label: 'Flashcards', badge: String(kit.flashcards.length) },
              { id: 'schedule', label: 'Schedule', badge: String(kit.schedule.days_available) },
            ]}
          />

          <div role="tabpanel">
            {tab === 'overview' && (
              <div className="space-y-6">
                <BriefSection kit={kit} mutations={mutations} sections={doc.sections} />
                <RoleSection kit={kit} />
              </div>
            )}
            {tab === 'questions' && <QuestionBank kit={kit} mutations={mutations} sections={doc.sections} />}
            {tab === 'flashcards' && <FlashcardList kitId={doc.id} kit={kit} mutations={mutations} sections={doc.sections} />}
            {tab === 'schedule' && <ScheduleView kit={kit} mutations={mutations} sections={doc.sections} />}
          </div>
        </>
      )}
    </div>
  )
}

function KitView({ id }: { id: string }) {
  const { doc, error, loading, refresh, setDoc } = useKit(id)

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

  return <KitBuilder doc={doc} setDoc={(next) => setDoc(next)} refresh={refresh} />
}

export default function KitPage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <KitView id={params.id} />
    </RequireAuth>
  )
}
