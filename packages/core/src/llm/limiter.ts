/**
 * A token bucket rather than a request counter, because free-tier limits are
 * expressed in tokens per minute and a single question-generation call can be
 * worth dozens of small ones. Costs above capacity are clamped so a large call
 * waits for a full bucket instead of deadlocking.
 */
export class TokenBucket {
  private capacity: number
  private refillPerMs: number
  private tokens: number
  private lastRefill: number

  constructor(opts: { capacity: number; refillPerMs: number }) {
    this.capacity = Math.max(1, opts.capacity)
    this.refillPerMs = Math.max(Number.EPSILON, opts.refillPerMs)
    this.tokens = this.capacity
    this.lastRefill = Date.now()
  }

  async take(cost: number): Promise<void> {
    const wanted = Math.min(Math.max(0, cost), this.capacity)
    for (;;) {
      this.refill()
      if (this.tokens >= wanted) {
        this.tokens -= wanted
        return
      }
      const deficit = wanted - this.tokens
      const waitMs = Math.max(1, Math.ceil(deficit / this.refillPerMs))
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    if (elapsed <= 0) return
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    this.lastRefill = now
  }
}
