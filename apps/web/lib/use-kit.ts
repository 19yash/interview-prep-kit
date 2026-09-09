'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { KitDoc, KitStatus } from './types'

export const DEFAULT_POLL_MS = 1500

export function isUnfinished(status: KitStatus): boolean {
  return status === 'queued' || status === 'running'
}

/**
 * Owns kit freshness for a page. Polls only while generation is unfinished, so
 * a finished kit costs nothing to sit on, and exposes setDoc so an edit can be
 * applied locally at once and the server response folded in when it lands.
 */
export function useKit(id: string, opts: { intervalMs?: number; fetcher?: (id: string) => Promise<KitDoc> } = {}) {
  const [doc, setDoc] = useState<KitDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fetcher = opts.fetcher ?? api.getKit
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await fetcher(id)
      if (!mounted.current) return
      setDoc(next)
      setError(null)
    } catch (caught) {
      if (!mounted.current) return
      setError(caught instanceof ApiError ? caught.message : 'could not load this kit')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [id, fetcher])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Keyed on the status rather than the document: every poll replaces the
  // document, and depending on it would clear and restart the interval each
  // time, so the tick drifts and a slow response can stall polling entirely.
  const status = doc?.status ?? null
  useEffect(() => {
    if (!status || !isUnfinished(status)) return
    const timer = setInterval(() => void refresh(), opts.intervalMs ?? DEFAULT_POLL_MS)
    return () => clearInterval(timer)
  }, [status, refresh, opts.intervalMs])

  return { doc, error, loading, refresh, setDoc }
}
