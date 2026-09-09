import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api.js'
import { isUnfinished, useKit } from '../lib/use-kit.js'
import type { KitDoc } from '../lib/types.js'

function doc(status: KitDoc['status'], current: string | null = null): KitDoc {
  return {
    id: 'k1',
    status,
    input: { jd: 'x', companyUrl: 'https://a.test/', days: 3 },
    progress: { steps: [{ name: 'extractRequirements', status: 'done', ms: 900 }], current },
    kit: null,
    sections: {},
    practice: [],
    error: null,
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:05Z',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('isUnfinished', () => {
  it('is true only while work remains', () => {
    expect(isUnfinished('queued')).toBe(true)
    expect(isUnfinished('running')).toBe(true)
    expect(isUnfinished('ready')).toBe(false)
    expect(isUnfinished('partial')).toBe(false)
    expect(isUnfinished('failed')).toBe(false)
  })
})

describe('useKit', () => {
  it('loads the kit and clears the loading flag', async () => {
    const getKit = vi.fn(async () => doc('ready'))
    const { result } = renderHook(() => useKit('k1', { fetcher: getKit }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.doc?.status).toBe('ready')
  })

  it('polls while the kit is running', async () => {
    vi.useFakeTimers()
    const getKit = vi.fn(async () => doc('running', 'discoverPages'))
    renderHook(() => useKit('k1', { intervalMs: 50, fetcher: getKit }))
    // Let the first load settle so the polling effect is mounted before the
    // clock moves; otherwise the whole advance happens while doc is still null.
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(getKit.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops polling once the kit is ready', async () => {
    vi.useFakeTimers()
    const getKit = vi.fn(async () => doc('ready'))
    renderHook(() => useKit('k1', { intervalMs: 50, fetcher: getKit }))
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    const callsAfterSettle = getKit.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(getKit.mock.calls.length).toBe(callsAfterSettle)
  })

  it('surfaces an error message', async () => {
    const getKit = vi.fn(async (): Promise<KitDoc> => {
      throw new ApiError(404, 'NOT_FOUND', 'no such kit')
    })
    const { result } = renderHook(() => useKit('k1', { fetcher: getKit }))
    await waitFor(() => expect(result.current.error).toBe('no such kit'))
  })

  it('lets a caller replace the document optimistically', async () => {
    const getKit = vi.fn(async () => doc('ready'))
    const { result } = renderHook(() => useKit('k1', { fetcher: getKit }))
    await waitFor(() => expect(result.current.doc).not.toBeNull())
    act(() => {
      result.current.setDoc({ ...doc('ready'), id: 'replaced' })
    })
    expect(result.current.doc?.id).toBe('replaced')
  })
})
