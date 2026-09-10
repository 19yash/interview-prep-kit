import { describe, expect, it, vi } from 'vitest'
import { GeminiKeyPool, maskKey } from '../src/llm/key-pool.js'

describe('maskKey', () => {
  it('masks keys properly for logging without revealing secret', () => {
    expect(maskKey('AIzaSyAbc123456789xyz')).toBe('AIza...9xyz')
    expect(maskKey('short')).toBe('****')
  })
})

describe('GeminiKeyPool', () => {
  it('parses comma-separated string of keys and trims whitespace', () => {
    const pool = new GeminiKeyPool('key1, key2 , key3, key1')
    expect(pool.size).toBe(3)
    expect(pool.availableCount).toBe(3)
    expect(pool.getActiveKey()).toBe('key1')
  })

  it('parses an array of keys', () => {
    const pool = new GeminiKeyPool(['keyA', 'keyB'])
    expect(pool.size).toBe(2)
    expect(pool.getActiveKey()).toBe('keyA')
  })

  it('throws when getting active key from empty pool', () => {
    const pool = new GeminiKeyPool([])
    expect(() => pool.getActiveKey()).toThrow('No Gemini API keys configured')
  })

  it('rotates to next key when current key is marked exhausted', () => {
    const pool = new GeminiKeyPool(['key1', 'key2', 'key3'])
    expect(pool.getActiveKey()).toBe('key1')

    const nextKey = pool.markDailyQuotaExhausted('key1', 3600000, 'RESOURCE_EXHAUSTED')
    expect(nextKey).toBe('key2')
    expect(pool.getActiveKey()).toBe('key2')
    expect(pool.availableCount).toBe(2)
  })

  it('skips exhausted keys and finds next available key', () => {
    const pool = new GeminiKeyPool(['key1', 'key2', 'key3'])
    pool.markDailyQuotaExhausted('key1', 3600000)
    pool.markDailyQuotaExhausted('key2', 3600000)

    expect(pool.getActiveKey()).toBe('key3')
    expect(pool.availableCount).toBe(1)
  })

  it('throws error when all keys are exhausted', () => {
    const pool = new GeminiKeyPool(['key1', 'key2'])
    pool.markDailyQuotaExhausted('key1', 3600000)
    pool.markDailyQuotaExhausted('key2', 3600000)

    expect(pool.hasAvailableKey()).toBe(false)
    expect(() => pool.getActiveKey()).toThrow('All 2 Gemini API keys have exhausted their daily quota')
  })

  it('resets cooldown when cooldown time has elapsed', () => {
    const pool = new GeminiKeyPool(['key1'])
    pool.markDailyQuotaExhausted('key1', 500) // 500ms cooldown
    expect(pool.hasAvailableKey()).toBe(false)

    vi.setSystemTime(Date.now() + 600)
    expect(pool.hasAvailableKey()).toBe(true)
    expect(pool.getActiveKey()).toBe('key1')
    vi.useRealTimers()
  })

  it('permanently marks invalid keys', () => {
    const pool = new GeminiKeyPool(['invalidKey', 'validKey'])
    pool.markInvalid('invalidKey', 'API_KEY_INVALID')

    expect(pool.getActiveKey()).toBe('validKey')
    expect(pool.availableCount).toBe(1)

    // Even if time passes, invalid key remains unusable
    vi.setSystemTime(Date.now() + 100_000_000)
    expect(pool.getActiveKey()).toBe('validKey')
    vi.useRealTimers()
  })

  it('provides pool diagnostic status', () => {
    const pool = new GeminiKeyPool(['AIzaSyTestKey111111', 'AIzaSyTestKey222222'])
    pool.markDailyQuotaExhausted('AIzaSyTestKey111111', 10000)

    const status = pool.getPoolStatus()
    expect(status.total).toBe(2)
    expect(status.available).toBe(1)
    expect(status.keys[0]!.masked).toBe('AIza...1111')
    expect(status.keys[0]!.isAvailable).toBe(false)
    expect(status.keys[1]!.masked).toBe('AIza...2222')
    expect(status.keys[1]!.isAvailable).toBe(true)
  })
})
