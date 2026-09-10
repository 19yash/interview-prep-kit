import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createGeminiClient, createStubClient, LlmError } from '../src/llm/client.js'

const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }
const parse = (raw: unknown) => z.object({ value: z.string() }).parse(raw)
const call = { system: 'sys', prompt: 'prompt', schema }

function client(generate: (n: number) => Promise<{ text: string }>, overrides = {}) {
  let n = 0
  return createGeminiClient({
    apiKey: 'test',
    sleep: async () => {},
    generate: async () => {
      n += 1
      return generate(n)
    },
    ...overrides,
  } as never)
}

describe('generateJson', () => {
  it('parses a clean JSON response', async () => {
    const c = client(async () => ({ text: '{"value":"ok"}' }))
    await expect(c.generateJson(call, parse)).resolves.toEqual({ value: 'ok' })
  })

  it('strips a markdown code fence the model added anyway', async () => {
    const c = client(async () => ({ text: '```json\n{"value":"fenced"}\n```' }))
    await expect(c.generateJson(call, parse)).resolves.toEqual({ value: 'fenced' })
  })

  it('retries once with the parse error fed back, then succeeds', async () => {
    const c = client(async (n) => ({ text: n === 1 ? 'not json at all' : '{"value":"second"}' }))
    await expect(c.generateJson(call, parse)).resolves.toEqual({ value: 'second' })
  })

  it('throws INVALID_JSON after exhausting repair attempts', async () => {
    const c = client(async () => ({ text: 'still not json' }))
    await expect(c.generateJson(call, parse)).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })

  it('backs off and retries on a 429, then succeeds', async () => {
    const sleep = vi.fn(async () => {})
    const c = client(
      async (n) => {
        if (n === 1) {
          const error = Object.assign(new Error('429 Too Many Requests'), { status: 429 })
          throw error
        }
        return { text: '{"value":"after-backoff"}' }
      },
      { sleep },
    )
    await expect(c.generateJson(call, parse)).resolves.toEqual({ value: 'after-backoff' })
    expect(sleep).toHaveBeenCalled()
  })

  it('gives up with RATE_LIMITED after the attempt budget', async () => {
    const c = client(async () => {
      throw Object.assign(new Error('429'), { status: 429 })
    })
    await expect(c.generateJson(call, parse)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('treats an empty response as EMPTY rather than a parse failure', async () => {
    const c = client(async () => ({ text: '' }))
    await expect(c.generateJson(call, parse)).rejects.toMatchObject({ code: 'EMPTY' })
  })

  it('reports a non-retryable provider error immediately', async () => {
    let calls = 0
    const c = client(async () => {
      calls += 1
      throw Object.assign(new Error('400 bad request'), { status: 400 })
    })
    await expect(c.generateJson(call, parse)).rejects.toBeInstanceOf(LlmError)
    expect(calls).toBe(1)
  })

  it('automatically fails over to next key when a key hits daily quota limit', async () => {
    const keysUsed: string[] = []
    const c = createGeminiClient({
      apiKeys: ['key1', 'key2'],
      sleep: async () => {},
      generate: async ({ apiKey }) => {
        keysUsed.push(apiKey ?? '')
        if (apiKey === 'key1') {
          throw Object.assign(new Error('ResourceExhausted: Quota exceeded for metric PerDayPerProject'), {
            status: 429,
          })
        }
        return { text: '{"value":"from-key2"}' }
      },
    } as never)

    const result = await c.generateJson(call, parse)
    expect(result).toEqual({ value: 'from-key2' })
    expect(keysUsed).toEqual(['key1', 'key2'])
  })

  it('fails over to next key when a key is invalid', async () => {
    const keysUsed: string[] = []
    const c = createGeminiClient({
      apiKeys: ['badKey', 'goodKey'],
      sleep: async () => {},
      generate: async ({ apiKey }) => {
        keysUsed.push(apiKey ?? '')
        if (apiKey === 'badKey') {
          throw Object.assign(new Error('API_KEY_INVALID: API key not valid'), { status: 400 })
        }
        return { text: '{"value":"from-goodKey"}' }
      },
    } as never)

    const result = await c.generateJson(call, parse)
    expect(result).toEqual({ value: 'from-goodKey' })
    expect(keysUsed).toEqual(['badKey', 'goodKey'])
  })

  it('throws RATE_LIMITED when all keys in pool exhaust their daily quota', async () => {
    const c = createGeminiClient({
      apiKeys: ['keyA', 'keyB'],
      sleep: async () => {},
      generate: async () => {
        throw Object.assign(new Error('ResourceExhausted: PerDay limit exceeded'), { status: 429 })
      },
    } as never)

    await expect(c.generateJson(call, parse)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })
})

describe('createStubClient', () => {
  it('returns queued json responses in order', async () => {
    const stub = createStubClient({ json: [{ value: 'a' }, { value: 'b' }] })
    await expect(stub.generateJson(call, parse)).resolves.toEqual({ value: 'a' })
    await expect(stub.generateJson(call, parse)).resolves.toEqual({ value: 'b' })
  })

  it('can be told to fail a set number of times first', async () => {
    const stub = createStubClient({ json: [{ value: 'a' }], failJsonTimes: 1 })
    await expect(stub.generateJson(call, parse)).rejects.toBeInstanceOf(LlmError)
    await expect(stub.generateJson(call, parse)).resolves.toEqual({ value: 'a' })
  })

  it('returns the configured grounded result', async () => {
    const stub = createStubClient({ grounded: { text: 'they run a take-home', sources: ['https://x.test/'] } })
    await expect(stub.generateGrounded({ system: 's', prompt: 'p' })).resolves.toEqual({
      text: 'they run a take-home',
      sources: ['https://x.test/'],
    })
  })
})
