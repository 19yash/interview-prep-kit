import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePractice } from '../lib/use-practice.js'
import type { Flashcard, PracticeOrder } from '../lib/types.js'

function card(id: string): Flashcard {
  return { id, front: `front ${id}`, back: `back ${id}`, requirement_ids: ['r1'], origin: 'generated', pinned: false, rev: 0 }
}

const cards = [card('f1'), card('f2'), card('f3')]

function client(order: string[], overrides: Partial<{ record: () => Promise<PracticeOrder> }> = {}) {
  const result: PracticeOrder = { order, covered: [], notCovered: order }
  return {
    practiceOrder: vi.fn(async () => result),
    recordPractice: overrides.record
      ? vi.fn(overrides.record)
      : vi.fn(async (_kitId: string, cardId: string) => ({
          order,
          covered: [cardId],
          notCovered: order.filter((id) => id !== cardId),
        })),
  }
}

async function session(order: string[], overrides?: Parameters<typeof client>[1], deck = cards) {
  const stub = client(order, overrides)
  const rendered = renderHook(() => usePractice({ kitId: 'k1', cards: deck, client: stub }))
  await waitFor(() => expect(rendered.result.current.status).not.toBe('loading'))
  return { rendered, stub }
}

describe('usePractice', () => {
  it('uses the order the server gave, not the deck order', async () => {
    const { rendered } = await session(['f3', 'f1', 'f2'])
    expect(rendered.result.current.queue.map((item) => item.id)).toEqual(['f3', 'f1', 'f2'])
    expect(rendered.result.current.card?.id).toBe('f3')
  })

  it('starts with the answer hidden', async () => {
    const { rendered } = await session(['f1', 'f2'])
    expect(rendered.result.current.revealed).toBe(false)
  })

  it('reveals on request', async () => {
    const { rendered } = await session(['f1'])
    act(() => rendered.result.current.reveal())
    expect(rendered.result.current.revealed).toBe(true)
  })

  it('hides the answer again when moving on', async () => {
    const { rendered } = await session(['f1', 'f2'])
    act(() => rendered.result.current.reveal())
    act(() => rendered.result.current.next())
    expect(rendered.result.current.revealed).toBe(false)
    expect(rendered.result.current.card?.id).toBe('f2')
  })

  it('records a rating and advances', async () => {
    const { rendered, stub } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    expect(stub.recordPractice).toHaveBeenCalledWith('k1', 'f1', 1)
    expect(rendered.result.current.card?.id).toBe('f2')
    expect(rendered.result.current.ratedThisSession.get('f1')).toBe(1)
  })

  it('takes the covered lists from the server response', async () => {
    const { rendered } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(3)
    })
    expect(rendered.result.current.covered).toEqual(['f1'])
    expect(rendered.result.current.notCovered).toEqual(['f2'])
  })

  it('finishes after the last card rather than wrapping', async () => {
    const { rendered } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(2)
    })
    await act(async () => {
      await rendered.result.current.rate(2)
    })
    expect(rendered.result.current.finished).toBe(true)
    expect(rendered.result.current.card).toBeNull()
  })

  it('goes back to the previous card without losing its rating', async () => {
    const { rendered } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    act(() => rendered.result.current.previous())
    expect(rendered.result.current.card?.id).toBe('f1')
    expect(rendered.result.current.ratedThisSession.get('f1')).toBe(1)
  })

  it('will not go back past the first card', async () => {
    const { rendered } = await session(['f1', 'f2'])
    act(() => rendered.result.current.previous())
    expect(rendered.result.current.index).toBe(0)
  })

  it('keeps the position and reports the message when a rating fails', async () => {
    class ApiErrorish extends Error {}
    const { rendered } = await session(['f1', 'f2'], {
      record: async () => {
        throw new ApiErrorish('could not save that')
      },
    })
    act(() => rendered.result.current.reveal())
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    expect(rendered.result.current.card?.id).toBe('f1')
    expect(rendered.result.current.revealed).toBe(true)
    expect(rendered.result.current.error).toBeTruthy()
  })

  it('skips an id in the order that no longer has a card', async () => {
    const { rendered } = await session(['gone', 'f1'])
    expect(rendered.result.current.queue.map((item) => item.id)).toEqual(['f1'])
  })

  it('reports an empty deck rather than a broken session', async () => {
    const { rendered } = await session([], undefined, [])
    expect(rendered.result.current.status).toBe('empty')
    expect(rendered.result.current.card).toBeNull()
  })

  it('falls back to the deck order when the server order is empty but cards exist', async () => {
    const { rendered } = await session([])
    expect(rendered.result.current.queue.map((item) => item.id)).toEqual(['f1', 'f2', 'f3'])
  })

  it('reports an error state when the order cannot be fetched', async () => {
    const stub = {
      practiceOrder: vi.fn(async () => {
        throw new Error('no such kit')
      }),
      recordPractice: vi.fn(),
    }
    const rendered = renderHook(() => usePractice({ kitId: 'k1', cards, client: stub as never }))
    await waitFor(() => expect(rendered.result.current.status).toBe('error'))
    expect(rendered.result.current.error).toBeTruthy()
  })

  it('restarts with a freshly fetched order', async () => {
    const { rendered, stub } = await session(['f1', 'f2'])
    await act(async () => {
      await rendered.result.current.rate(1)
    })
    await act(async () => {
      await rendered.result.current.restart()
    })
    expect(stub.practiceOrder).toHaveBeenCalledTimes(2)
    expect(rendered.result.current.index).toBe(0)
    expect(rendered.result.current.ratedThisSession.size).toBe(0)
  })

  it('does not restart automatically when cards prop reference changes after finishing', async () => {
    const stub = client(['f1', 'f2'])
    let deck = [...cards.slice(0, 2)]
    const rendered = renderHook(
      ({ currentCards }) => usePractice({ kitId: 'k1', cards: currentCards, client: stub }),
      { initialProps: { currentCards: deck } },
    )
    await waitFor(() => expect(rendered.result.current.status).not.toBe('loading'))

    await act(async () => {
      await rendered.result.current.rate(2)
    })
    await act(async () => {
      await rendered.result.current.rate(3)
    })
    expect(rendered.result.current.finished).toBe(true)
    expect(stub.practiceOrder).toHaveBeenCalledTimes(1)

    // Re-render with a new array reference (like parent doc refresh())
    deck = [...deck]
    rendered.rerender({ currentCards: deck })

    // Must remain finished and not restart automatically
    expect(rendered.result.current.finished).toBe(true)
    expect(rendered.result.current.index).toBe(2)
    expect(stub.practiceOrder).toHaveBeenCalledTimes(1)
  })
})
