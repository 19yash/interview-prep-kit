import { describe, expect, it, vi } from 'vitest'
import { TokenBucket } from '../src/llm/limiter.js'

describe('TokenBucket', () => {
  it('allows calls that fit within capacity without waiting', async () => {
    const bucket = new TokenBucket({ capacity: 100, refillPerMs: 1 })
    const started = Date.now()
    await bucket.take(40)
    await bucket.take(40)
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('waits when the bucket is empty and refills over time', async () => {
    vi.useFakeTimers()
    const bucket = new TokenBucket({ capacity: 10, refillPerMs: 1 })
    await bucket.take(10)
    let resolved = false
    const pending = bucket.take(5).then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(5)
    await pending
    expect(resolved).toBe(true)
    vi.useRealTimers()
  })

  it('never blocks forever on a cost larger than capacity', async () => {
    vi.useFakeTimers()
    const bucket = new TokenBucket({ capacity: 10, refillPerMs: 1 })
    const pending = bucket.take(999)
    await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})
