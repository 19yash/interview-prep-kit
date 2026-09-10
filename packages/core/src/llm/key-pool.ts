export type KeyEntry = {
  key: string
  exhaustedUntil: number | null
  isInvalid: boolean
  failureCount: number
  successCount: number
}

export type KeyPoolStatus = {
  total: number
  available: number
  activeIndex: number
  keys: {
    masked: string
    isAvailable: boolean
    isInvalid: boolean
    exhaustedUntil: string | null
    successCount: number
    failureCount: number
  }[]
}

const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

export function maskKey(key: string): string {
  if (!key || key.length <= 8) return '****'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

export class GeminiKeyPool {
  private entries: KeyEntry[] = []
  private currentIndex = 0

  constructor(keys: string[] | string = []) {
    const rawKeys = Array.isArray(keys) ? keys : keys.split(',')
    const cleaned = rawKeys
      .map((k) => k.trim())
      .filter((k) => k.length > 0)

    const uniqueKeys = Array.from(new Set(cleaned))
    this.entries = uniqueKeys.map((key) => ({
      key,
      exhaustedUntil: null,
      isInvalid: false,
      failureCount: 0,
      successCount: 0,
    }))
  }

  static fromEnv(): GeminiKeyPool {
    const keysStr = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? ''
    return new GeminiKeyPool(keysStr)
  }

  get size(): number {
    return this.entries.length
  }

  get availableCount(): number {
    const now = Date.now()
    return this.entries.filter((e) => !e.isInvalid && (!e.exhaustedUntil || now >= e.exhaustedUntil)).length
  }

  hasAvailableKey(): boolean {
    return this.availableCount > 0
  }

  getActiveKey(): string {
    if (this.entries.length === 0) {
      throw new Error('No Gemini API keys configured in the pool')
    }

    const now = Date.now()
    // Find the next available key starting from currentIndex
    for (let offset = 0; offset < this.entries.length; offset += 1) {
      const idx = (this.currentIndex + offset) % this.entries.length
      const entry = this.entries[idx]!

      // Check if cooldown has expired
      if (entry.exhaustedUntil && now >= entry.exhaustedUntil) {
        entry.exhaustedUntil = null
      }

      if (!entry.isInvalid && !entry.exhaustedUntil) {
        this.currentIndex = idx
        return entry.key
      }
    }

    throw new Error(`All ${this.entries.length} Gemini API keys have exhausted their daily quota`)
  }

  markSuccess(key: string): void {
    const entry = this.entries.find((e) => e.key === key)
    if (entry) {
      entry.successCount += 1
      entry.failureCount = 0
    }
  }

  markDailyQuotaExhausted(key: string, cooldownMs = DEFAULT_COOLDOWN_MS, reason?: string): string | null {
    const entry = this.entries.find((e) => e.key === key)
    if (entry) {
      entry.exhaustedUntil = Date.now() + cooldownMs
      entry.failureCount += 1
      const reasonDetail = reason ? ` (${reason})` : ''
      console.warn(`[GeminiKeyPool] Key ${maskKey(key)} marked exhausted for ${Math.round(cooldownMs / 3600000)}h${reasonDetail}.`)
    }

    // Advance to next key if available
    if (this.hasAvailableKey()) {
      try {
        const nextKey = this.getActiveKey()
        console.warn(`[GeminiKeyPool] Switched to key ${maskKey(nextKey)}.`)
        return nextKey
      } catch {
        return null
      }
    }
    return null
  }

  markInvalid(key: string, reason?: string): string | null {
    const entry = this.entries.find((e) => e.key === key)
    if (entry) {
      entry.isInvalid = true
      entry.failureCount += 1
      const reasonDetail = reason ? ` (${reason})` : ''
      console.warn(`[GeminiKeyPool] Key ${maskKey(key)} marked invalid${reasonDetail}.`)
    }

    if (this.hasAvailableKey()) {
      try {
        const nextKey = this.getActiveKey()
        console.warn(`[GeminiKeyPool] Switched to key ${maskKey(nextKey)}.`)
        return nextKey
      } catch {
        return null
      }
    }
    return null
  }

  rotate(): string | null {
    if (this.entries.length <= 1) return null
    this.currentIndex = (this.currentIndex + 1) % this.entries.length
    try {
      return this.getActiveKey()
    } catch {
      return null
    }
  }

  getPoolStatus(): KeyPoolStatus {
    const now = Date.now()
    return {
      total: this.entries.length,
      available: this.availableCount,
      activeIndex: this.currentIndex,
      keys: this.entries.map((entry) => ({
        masked: maskKey(entry.key),
        isAvailable: !entry.isInvalid && (!entry.exhaustedUntil || now >= entry.exhaustedUntil),
        isInvalid: entry.isInvalid,
        exhaustedUntil: entry.exhaustedUntil ? new Date(entry.exhaustedUntil).toISOString() : null,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
      })),
    }
  }
}
