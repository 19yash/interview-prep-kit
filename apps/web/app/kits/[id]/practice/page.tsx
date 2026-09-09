'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { FlashcardPlayer } from '@/components/practice/FlashcardPlayer'
import { PracticeEmpty } from '@/components/practice/PracticeEmpty'
import { SessionSummary } from '@/components/practice/SessionSummary'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { practiceStats } from '@/lib/practice-stats'
import { useKit } from '@/lib/use-kit'
import { usePractice } from '@/lib/use-practice'
import type { KitDoc } from '@/lib/types'

function Session({ doc, refresh }: { doc: KitDoc; refresh: () => Promise<void> }) {
  const cards = doc.kit?.flashcards ?? []
  const session = usePractice({ kitId: doc.id, cards })
  const stats = practiceStats(cards, doc.practice)

  useEffect(() => {
    if (session.finished) void refresh()
  }, [session.finished, refresh])

  if (session.status === 'empty') return <PracticeEmpty kitId={doc.id} />
  if (session.status === 'loading') return <StateBlock state="loading" title="Setting up your session" />
  if (session.status === 'error') {
    return (
      <StateBlock
        state="error"
        title="Could not start a practice session"
        detail={session.error ?? undefined}
        action={<Button onClick={() => void session.restart()}>Try again</Button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Practice</h1>
          <p className="text-sm text-slate-600">{doc.kit?.role.title ?? 'This kit'}</p>
        </div>
        <Link href={`/kits/${doc.id}`}>
          <Button variant="secondary" size="sm">
            Back to the kit
          </Button>
        </Link>
      </div>

      {session.finished ? (
        <SessionSummary
          stats={practiceStats(cards, doc.practice)}
          ratedThisSession={session.ratedThisSession.size}
          onRestart={() => void session.restart()}
          kitId={doc.id}
        />
      ) : (
        <FlashcardPlayer session={session} deckSize={stats.total} />
      )}
    </div>
  )
}

function PracticeView({ id }: { id: string }) {
  const { doc, loading, error, refresh } = useKit(id)

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
  if (!doc.kit) {
    return (
      <StateBlock
        state="empty"
        title="This kit is still being built"
        detail="Practice becomes available once generation finishes."
        action={
          <Link href={`/kits/${id}`}>
            <Button variant="secondary">Watch it build</Button>
          </Link>
        }
      />
    )
  }

  return <Session doc={doc} refresh={refresh} />
}

export default function PracticePage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <PracticeView id={params.id} />
    </RequireAuth>
  )
}
