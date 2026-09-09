'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { KitListItem } from '@/components/kits/KitListItem'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { api, ApiError } from '@/lib/api'
import type { KitSummary } from '@/lib/types'

const REFRESH_MS = 4000

function KitList() {
  const [kits, setKits] = useState<KitSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setKits(await api.listKits())
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'something went wrong')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Kits generating in the background change status without any user action,
  // so the list refreshes while any of them is unfinished — and stops when
  // none are, rather than polling forever.
  useEffect(() => {
    const unfinished = kits?.some((kit) => kit.status === 'queued' || kit.status === 'running')
    if (!unfinished) return
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [kits, load])

  async function remove(id: string) {
    setKits((current) => current?.filter((kit) => kit.id !== id) ?? null)
    try {
      await api.deleteKit(id)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'could not delete that kit')
      void load()
    }
  }

  if (error && kits === null) {
    return <StateBlock state="error" title="Could not load your kits" detail={error} action={<Button onClick={() => void load()}>Try again</Button>} />
  }
  if (kits === null) return <StateBlock state="loading" title="Loading your kits" />

  if (kits.length === 0) {
    return (
      <StateBlock
        state="empty"
        title="No kits yet"
        detail="Paste a job description and a company website address, and the first kit takes a minute or two to build."
        action={
          <Link href="/kits/new">
            <Button>Build my first kit</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My kits</h1>
        <Link href="/kits/new">
          <Button size="sm">New kit</Button>
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="rounded-lg border border-slate-200 bg-white">
        {kits.map((kit) => (
          <KitListItem key={kit.id} kit={kit} onDelete={(id) => void remove(id)} />
        ))}
      </ul>
    </div>
  )
}

export default function KitsPage() {
  return (
    <RequireAuth>
      <KitList />
    </RequireAuth>
  )
}
